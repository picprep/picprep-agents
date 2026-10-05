'use strict';
// picprep-mcp: lets an assistant that runs a local command (any MCP client over stdio) reach the
// PicPrep app on this computer.
//
// It is a pipe, not a server of its own. The app serves MCP at POST /mcp on its loopback server
// (Streamable HTTP, behind the session token); this reads each JSON-RPC line from stdin, sends it
// there, and writes back every message the app answers with. It knows no tool: the tool list, the
// schemas and the instructions all come from the app, so a new app release changes the tools without
// a new release of this package.
//
// stdout carries protocol messages ONLY - anything else written there breaks the client - so every
// note goes to stderr. Node standard library only, on purpose: `npx -y picprep-mcp` must just work.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const VERSION = require('./package.json').version;
const APP = 'picprep';
// The state folder's name before the product was renamed (PhotoPrep -> PicPrep, 2026-10-04). The app moves it to
// the new name the first time it starts after the rename (its src/paths.js); see userDir().
const LEGACY_APP = 'photoprep';   // the older name
// The installed app's macOS bundle id: the app's forge config pins `appBundleId`; both must stay equal.
const MAC_BUNDLE_ID = 'com.picprep.app';
const START_WAIT_MS = 30000;
const DEFAULT_PROTOCOL = '2025-06-18';

class BridgeError extends Error {}

// A setting from the environment, as the app reads it: PICPREP_<NAME>, or the older PHOTOPREP_<NAME>. Both set to
// different values is refused rather than guessed between, as the app does.
function env(name) {
  const set = v => v != null && v !== '';
  const now = process.env['PICPREP_' + name], old = process.env['PHOTOPREP_' + name];
  if (set(now) && set(old) && now !== old) throw new BridgeError('PICPREP_' + name + ' is "' + now + '" but PHOTOPREP_' + name + ' is "' + old + '": set only one');
  return set(now) ? now : set(old) ? old : undefined;
}

// Where the app keeps its state. Kept identical to the app's src/paths.js userDir(): the two must
// agree or the bridge never finds a running app (test/bridge.js compares them on every OS).
// One exception: while only the folder from before the rename exists, the app has not started since, and its
// state is still there. Read it, and never create the new folder beside it: the app would keep that (empty)
// new folder and leave the person's projects behind in the old one.
function userDir() {
  const home = env('HOME');
  if (home) return path.resolve(home);
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const dir = path.join(base, APP), legacy = path.join(base, LEGACY_APP);
  return !fs.existsSync(dir) && fs.existsSync(legacy) ? legacy : dir;
}

// The running app announces itself here: {port, token, pid}, rewritten on every start.
const stateFile = () => path.join(userDir(), 'state', 'server.json');
// The app's initialize answer and tool list from the last time it ran (see `run`): lets a client
// start without starting the app.
const cacheFile = () => path.join(userDir(), 'state', 'mcp-catalogue.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    // Absent: the app is not running (or never ran). Half-written: the app is writing it right now.
    if (e.code === 'ENOENT' || e instanceof SyntaxError) return null;
    throw new BridgeError('cannot read ' + file + ': ' + e.message);
  }
}

function readState() {
  const s = readJson(stateFile());
  if (!s || !Number.isInteger(s.port) || typeof s.token !== 'string' || !s.token) return null;
  return { port: s.port, token: s.token };
}

// --- HTTP to the app ----------------------------------------------------------------------------------
// node:http rather than fetch: fetch gives up on an answer after 300 s, and a tool may wait longer
// than that for the person (get_outcome waits up to 600 s).
// agent: false, a connection of its own for each message: Node's shared agent closes a connection that has been
// quiet for 5 s, which cut off every call the app took longer than that to answer. A call waits as long as the
// app takes, unless the caller gives a timeout.
function request(conn, method, p, { headers = {}, body, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: conn.port, method, path: p, timeout, agent: false,
      headers: Object.assign({ 'x-photoprep-token': conn.token }, headers),
    }, resolve);
    req.on('timeout', () => req.destroy(Object.assign(new Error('no answer within ' + timeout + ' ms'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

function readAll(res) {
  return new Promise((resolve, reject) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', d => { text += d; });
    res.on('end', () => resolve(text));
    res.on('error', reject);
  });
}

// A Streamable HTTP answer may be a stream of server-sent events, each carrying one JSON-RPC message
// (progress notifications, then the response). Each goes on as soon as it arrives.
function readEvents(res, onMessage) {
  return new Promise((resolve, reject) => {
    let buf = '', data = [];
    const deliver = () => {
      const text = data.join('\n'); data = [];
      let msg;
      try { msg = JSON.parse(text); } catch (_) { return reject(new BridgeError('PicPrep sent an event that is not JSON: ' + clip(text))); }
      onMessage(msg);
    };
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buf += chunk;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line === '') { if (data.length) deliver(); }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        // event:, id:, retry: and comments carry nothing a pipe needs.
      }
    });
    res.on('end', () => { if (data.length) deliver(); resolve(); });
    res.on('error', reject);
  });
}

const clip = s => { s = String(s || '').trim(); return s.length > 300 ? s.slice(0, 300) + '...' : s; };

async function healthy(conn) {
  try {
    const res = await request(conn, 'GET', '/health', { timeout: 2000 });
    const text = await readAll(res);
    return res.statusCode === 200 && [APP, LEGACY_APP].includes(JSON.parse(text).app);   // an app from before the rename says photoprep
  } catch (_) {
    return false;   // refused, timed out, or something other than PicPrep on that port: not the app
  }
}

async function running() {
  const s = readState();
  return s && await healthy(s) ? s : null;
}

// --- starting the installed app -------------------------------------------------------------------------
// What to run to start the app on this system, or a BridgeError naming where it looked.
// PICPREP_APP (or the older PHOTOPREP_APP) names the app's executable when it lives somewhere else (a Linux zip, a dev build).
function findApp() {
  const args = ['--launched-by=mcp'];
  const given = env('APP');
  if (given) {
    const file = path.resolve(given);
    if (fs.existsSync(file)) return { cmd: file, args, where: file };
    throw notInstalled(file + ' (' + (process.env.PICPREP_APP ? 'PICPREP_APP' : 'PHOTOPREP_APP') + ')');   // the older name, when that is the one set
  }
  // `open` finds the app wherever it was installed, and says so when it is not; -g keeps it in the background.
  if (process.platform === 'darwin') return { cmd: 'open', args: ['-g', '-b', MAC_BUNDLE_ID, '--args', ...args], where: 'an app with bundle id ' + MAC_BUNDLE_ID };
  let candidates;
  if (process.platform === 'win32') {
    // The Squirrel installer's stub, which starts the newest installed version.
    candidates = [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP, APP + '.exe')];
  } else {
    const onPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, APP));
    candidates = [...new Set(['/usr/bin/' + APP, '/usr/lib/' + APP + '/' + APP, ...onPath])];
  }
  const found = candidates.find(f => fs.existsSync(f));
  if (found) return { cmd: found, args, where: found };
  throw notInstalled(candidates.join(', '));
}

const notInstalled = where => new BridgeError('PicPrep is not installed on this computer (looked for ' + where + '). Install it, open it once, then try again.');

async function launch(log) {
  const app = findApp();
  log('PicPrep is not running; starting ' + app.where);
  let failed = null;
  const isOpen = app.cmd === 'open';
  // Detached and unwatched, so the app outlives this session. Only `open` is waited on: it returns at
  // once, and its error text is the one that says the app is missing.
  // Windows runs a .cmd only through the shell, which splits an unquoted path at its spaces.
  const viaShell = /\.(cmd|bat)$/i.test(app.cmd);
  const child = spawn(viaShell ? '"' + app.cmd + '"' : app.cmd, app.args, {
    detached: !isOpen, stdio: ['ignore', 'ignore', isOpen ? 'pipe' : 'ignore'],
    env: Object.assign({}, process.env, { PICPREP_LAUNCHED_BY: 'mcp', PHOTOPREP_LAUNCHED_BY: 'mcp' }),   // the older name too: the app reads either
    shell: viaShell,
  });
  let err = '';
  if (isOpen) child.stderr.on('data', d => { err += d; });
  child.on('error', e => { failed = e.code === 'ENOENT' ? notInstalled(app.where) : new BridgeError('could not start PicPrep (' + app.where + '): ' + e.message); });
  child.on('exit', code => {
    if (!code) return;   // a normal exit (open, or a second instance handing over) is not a failure
    failed = isOpen && /unable to find application/i.test(err) ? notInstalled(app.where) : new BridgeError('PicPrep (' + app.where + ') exited with code ' + code + (err.trim() ? ': ' + clip(err) : ''));
  });
  if (!isOpen) child.unref();
  for (const until = Date.now() + START_WAIT_MS; Date.now() < until;) {
    await new Promise(r => setTimeout(r, 250));
    if (failed) throw failed;
    const s = await running();
    if (s) return s;
  }
  throw new BridgeError('PicPrep was started but did not answer within ' + START_WAIT_MS / 1000 + ' s (no live app in ' + stateFile() + '). Open PicPrep yourself, then try again.');
}

// --- the cached catalogue -------------------------------------------------------------------------------
// MCP clients start every configured server when a session opens, so starting the app at `initialize`
// would open PicPrep each time someone opens their editor. Instead, when the app is not running, the
// bridge answers initialize and tools/list with what the app itself said the last time it ran, and
// starts the app at the first real call. Once the app answers, the list is fetched again and the
// client is told (notifications/tools/list_changed) if an app update changed it. With no cache (the
// app never ran with this connector) the app is started at once.
function readCache() {
  const c = readJson(cacheFile());
  return c && c.initialize && Array.isArray(c.tools) ? c : null;
}

function saveCache(patch, log) {
  const file = cacheFile();
  try {
    const next = Object.assign({}, readJson(file) || {}, patch);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next));
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    log('could not save ' + file + ' (the next start will open PicPrep at once): ' + e.message);
  }
}

// --- the pipe -------------------------------------------------------------------------------------------
function run({ input = process.stdin, output = process.stdout, log = m => process.stderr.write('picprep-mcp: ' + m + '\n') } = {}) {
  const write = msg => output.write(JSON.stringify(msg) + '\n');
  let conn = null;            // {port, token} of the app in use
  let sessionId = null;       // Mcp-Session-Id the app gave this session, if it uses them
  let protocol = null;        // the protocol version the app agreed to
  let ready = null;           // promise of a live, initialized session with the app
  let clientInit = null;      // the client's initialize params, replayed whenever the app (re)starts
  let fromCache = null;       // the cached catalogue this session was answered from, until the app runs
  let opening = null;         // the client's initialize while it is being answered: later messages wait for it
  let internal = 0;
  const pending = new Set();
  const ownId = () => 'picprep-mcp-' + (++internal);

  function reset() { ready = null; conn = null; sessionId = null; }

  // POST one message to /mcp. Every JSON-RPC message in the answer goes to onMessage. Resolves with the
  // HTTP status, and the body when it held no JSON-RPC message (for the error).
  async function post(msg, onMessage) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (protocol && msg.method !== 'initialize') headers['mcp-protocol-version'] = protocol;
    const res = await request(conn, 'POST', '/mcp', { headers, body: JSON.stringify(msg) });
    if (msg.method === 'initialize' && res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
    const type = String(res.headers['content-type'] || '');
    const okStatus = res.statusCode >= 200 && res.statusCode < 300;
    if (okStatus && type.startsWith('text/event-stream')) { await readEvents(res, onMessage); return { status: res.statusCode, delivered: true }; }
    const text = await readAll(res);
    if (!text.trim()) return { status: res.statusCode, text };   // 202: a notification or a reply was taken
    let data;
    try { data = JSON.parse(text); } catch (_) {
      if (okStatus) throw new BridgeError('PicPrep answered ' + (msg.method || 'a reply') + ' with something that is not JSON: ' + clip(text));
      return { status: res.statusCode, text };
    }
    const messages = [].concat(data).filter(m => m && m.jsonrpc === '2.0');
    if (!messages.length) {
      if (okStatus) throw new BridgeError('PicPrep answered ' + (msg.method || 'a reply') + ' with JSON that is not a JSON-RPC message: ' + clip(text));
      return { status: res.statusCode, text };
    }
    messages.forEach(onMessage);
    return { status: res.statusCode, delivered: true };
  }

  // Find (or start) the app and open a session with it, as the client asked for one.
  function live() {
    if (ready) return ready;
    ready = (async () => {
      conn = await running() || await launch(log);
      sessionId = null; protocol = null;
      const params = clientInit || { protocolVersion: DEFAULT_PROTOCOL, capabilities: {}, clientInfo: { name: 'picprep-mcp', version: VERSION } };
      const init = { jsonrpc: '2.0', id: ownId(), method: 'initialize', params };
      let answer = null;
      const r = await post(init, m => { if (m.id === init.id) answer = m; });
      if (!answer) throw new BridgeError('PicPrep did not answer initialize (HTTP ' + r.status + (r.text ? ': ' + clip(r.text) : '') + ')');
      if (answer.error) throw new BridgeError('PicPrep refused initialize: ' + answer.error.message);
      protocol = answer.result.protocolVersion;
      // The bridge completes the handshake itself: the client's own notifications/initialized may
      // have gone by long before the app was started.
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, unexpected);
      const cached = readJson(cacheFile()) || {};
      const accepted = new Set(cached.accepted || []);
      if (protocol === params.protocolVersion) accepted.add(protocol);
      saveCache({ initialize: answer.result, accepted: [...accepted] }, log);
      return answer.result;
    })();
    ready.catch(reset);
    return ready;
  }

  const unexpected = m => log('PicPrep sent an unexpected message: ' + clip(JSON.stringify(m)));

  // After answering from the cache, check the cached tool list against the running app's.
  async function refreshTools() {
    const served = fromCache;
    fromCache = null;
    const req = { jsonrpc: '2.0', id: ownId(), method: 'tools/list', params: {} };
    let answer = null;
    await post(req, m => { if (m.id === req.id) answer = m; else unexpected(m); });
    if (!answer || !answer.result || !Array.isArray(answer.result.tools)) return log('PicPrep did not list its tools; the list from its last run stays in use');
    saveCache({ tools: answer.result.tools }, log);
    if (JSON.stringify(answer.result.tools) !== JSON.stringify(served.tools)) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }

  async function forward(msg) {
    for (let attempt = 0; ; attempt++) {
      await live();
      if (fromCache) await refreshTools();
      const used = conn;
      let r;
      try {
        r = await post(msg, m => {
          if (msg.method === 'tools/list' && m.id === msg.id && m.result && Array.isArray(m.result.tools) && !m.result.nextCursor && !(msg.params && msg.params.cursor)) saveCache({ tools: m.result.tools }, log);
          write(m);
        });
      } catch (e) {
        // The app quit since the last message: nothing reached it, so sending again is safe.
        if (attempt === 0 && e.code === 'ECONNREFUSED') { reset(); continue; }
        if (e instanceof BridgeError) throw e;
        throw new BridgeError('lost the connection to PicPrep during ' + (msg.method || 'a reply') + ': ' + e.message);
      }
      if (r.delivered || (r.status >= 200 && r.status < 300)) return;
      // A new token or port: the app restarted. 404 on our session: the app no longer knows it.
      // Either way the message was refused unread, so it is sent once more on a fresh session.
      if (attempt === 0) {
        const now = readState();
        const restarted = now && (now.token !== used.token || now.port !== used.port);
        if (((r.status === 401 || r.status === 403) && restarted) || (r.status === 404 && sessionId)) { reset(); continue; }
      }
      throw new BridgeError('PicPrep answered HTTP ' + r.status + ' to ' + (msg.method || 'a reply') + (r.text ? ': ' + clip(r.text) : ''));
    }
  }

  async function handle(msg) {
    // A client that sends its next message without waiting for the initialize answer: that message must see what
    // initialize decided (answer from the catalogue, or from the app), not start the app beside it.
    if (msg.method === 'initialize') { opening = initialize(msg); return opening; }
    if (opening) await opening.catch(() => {});
    return route(msg);
  }

  async function initialize(msg) {
    clientInit = msg.params || null;
    reset();
    const cache = !(await running()) && readCache();
    if (cache) {
      fromCache = cache;
      const result = JSON.parse(JSON.stringify(cache.initialize));
      const want = clientInit && clientInit.protocolVersion;
      if ((cache.accepted || []).includes(want)) result.protocolVersion = want;
      return write({ jsonrpc: '2.0', id: msg.id, result });
    }
    fromCache = null;
    return write({ jsonrpc: '2.0', id: msg.id, result: await live() });
  }

  async function route(msg) {
    const isRequest = msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';
    if (msg.method === 'notifications/initialized') return;   // the bridge sends the app its own (see live)
    if (fromCache && !ready) {
      if (msg.method === 'tools/list' && !(msg.params && msg.params.cursor)) return write({ jsonrpc: '2.0', id: msg.id, result: { tools: fromCache.tools } });
      if (msg.method === 'ping') return write({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (!isRequest) return;   // a notification for an app not started yet: there is nothing to tell
    }
    return forward(msg);
  }

  function answerError(msg, e) {
    const text = e instanceof BridgeError ? e.message : 'picprep-mcp failed: ' + (e && e.message || e);
    if (!(e instanceof BridgeError)) log(String(e && e.stack || e));
    if (msg.id === undefined || msg.id === null || typeof msg.method !== 'string') return log(text);
    // A failed tool call is a tool result the assistant reads (and can tell the person); anything else is a protocol error.
    if (msg.method === 'tools/call') return write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: true } });
    write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: text } });
  }

  return new Promise(resolve => {
    const rl = readline.createInterface({ input });
    rl.on('line', line => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error: not JSON: ' + clip(line) } }); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request: one JSON-RPC message per line, not ' + clip(line) } });
      // Messages are handled concurrently: one call waiting on the person must not hold up the rest.
      const p = handle(msg).catch(e => answerError(msg, e));
      pending.add(p);
      p.finally(() => pending.delete(p));
    });
    rl.on('close', async () => {
      await Promise.all([...pending]);
      // Tell the app the session is over (Streamable HTTP); it would expire it on its own anyway.
      if (sessionId && conn) {
        try { (await request(conn, 'DELETE', '/mcp', { headers: { 'mcp-session-id': sessionId }, timeout: 2000 })).resume(); }
        catch (e) { log('could not close the session with PicPrep: ' + e.message); }
      }
      resolve();
    });
  });
}

// `picprep-mcp --check`: says where it looks and what it found, for a person setting it up.
async function check(out = process.stdout) {
  const say = s => out.write(s + '\n');
  say('picprep-mcp ' + VERSION);
  say('PicPrep state folder: ' + userDir());
  const s = await running();
  if (s) {
    const res = await request(s, 'GET', '/health', { timeout: 2000 });
    say('PicPrep ' + JSON.parse(await readAll(res)).version + ' is running (port ' + s.port + '). The connector is ready.');
    return 0;
  }
  try {
    const app = findApp();
    say('PicPrep is not running. At the first tool call the connector starts ' + app.where + '.');
    return 0;
  } catch (e) {
    if (!(e instanceof BridgeError)) throw e;
    say(e.message);
    return 1;
  }
}

module.exports = { run, check, userDir, findApp, VERSION, MAC_BUNDLE_ID };
