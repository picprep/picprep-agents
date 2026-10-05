'use strict';
// picprep-mcp against a fake app (test/lib/fake-app.js): finding a running app, starting one,
// passing every message through unchanged in both Streamable HTTP answer forms, coming back after
// the app restarts, and saying plainly when there is no app. Every run uses a throwaway
// PICPREP_HOME and a PICPREP_APP that is never the real app, so no real PicPrep is touched or started.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { startFakeApp, toolsFor, LICENCE_TEXT } = require('./lib/fake-app');

const root = path.join(__dirname, '..');
const BIN = path.join(root, 'packages', 'picprep-mcp', 'bin', 'picprep-mcp.js');
const FAKE = path.join(__dirname, 'lib', 'fake-app.js');
let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };
const check = (cond, m, detail) => cond ? ok(m) : bad(m + (detail === undefined ? '' : ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const temps = [];
const tmpHome = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'picprep-mcp-test-')); temps.push(d); return d; };
const NO_APP = path.join(os.tmpdir(), 'picprep-mcp-test-no-such-app');
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bridge-test', version: '1' } };

// A launcher the bridge can run as "the installed app": starts the fake app as its own process.
function launcher(dir) {
  if (process.platform === 'win32') {
    const f = path.join(dir, 'fake-picprep.cmd');
    fs.writeFileSync(f, '@"' + process.execPath + '" "' + FAKE + '" %*\r\n');
    return f;
  }
  const f = path.join(dir, 'fake-picprep');
  fs.writeFileSync(f, '#!/bin/sh\nexec "' + process.execPath + '" "' + FAKE + '" "$@"\n', { mode: 0o755 });
  return f;
}
function killLaunched(home) {
  try { process.kill(JSON.parse(fs.readFileSync(path.join(home, 'state', 'server.json'), 'utf8')).pid); } catch (_) { /* never started */ }
}

// The bridge as an assistant runs it: a child process spoken to over stdin/stdout.
function bridge(env) {
  const clean = Object.assign({}, process.env);
  delete clean.PICPREP_HOME; delete clean.PICPREP_APP; delete clean.PHOTOPREP_HOME; delete clean.PHOTOPREP_APP; delete clean.FAKE_APP_VARIANT; delete clean.FAKE_APP_MODE;
  const child = spawn(process.execPath, [BIN], { env: Object.assign(clean, { PICPREP_APP: NO_APP }, env), stdio: ['pipe', 'pipe', 'pipe'] });
  const got = [], waiters = [];
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return bad('stdout carries only JSON-RPC, but got: ' + line); }
    got.push(msg);
    for (const w of waiters.slice()) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(msg); }
  });
  const exited = new Promise(r => child.on('exit', code => r(code)));
  return {
    got,
    stderr: () => stderr,
    send: m => child.stdin.write((typeof m === 'string' ? m : JSON.stringify(Object.assign({ jsonrpc: '2.0' }, m))) + '\n'),
    next: (pred, ms = 15000) => {
      const seen = got.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise(resolve => {
        const w = { pred, resolve, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms) };
        waiters.push(w);
      });
    },
    call: async function (id, method, params, ms) { this.send({ id, method, params }); return this.next(m => m.id === id, ms); },
    close: () => { child.stdin.end(); return exited; },
    kill: () => child.kill(),
  };
}
const byId = id => m => m.id === id;

async function main() {
  // --- 1. the user folder is the app's -----------------------------------------------------------------
  {
    const B = require('../packages/picprep-mcp/bridge');
    const src = require('./lib/app-src').appSrc();
    const appPaths = src ? path.join(src, 'src', 'paths.js') : null;
    const HOME = path.join(path.sep, 'home', 'someone');
    const cases = [
      ['darwin', {}, path.join(HOME, 'Library', 'Application Support', 'picprep')],
      ['win32', { APPDATA: path.join(HOME, 'Roaming') }, path.join(HOME, 'Roaming', 'picprep')],
      ['win32', {}, path.join(HOME, 'AppData', 'Roaming', 'picprep')],
      ['linux', {}, path.join(HOME, '.config', 'picprep')],
      ['linux', { XDG_CONFIG_HOME: path.join(HOME, 'xdg') }, path.join(HOME, 'xdg', 'picprep')],
      ['darwin', { PICPREP_HOME: 'relative-home' }, path.resolve('relative-home')],
      ['darwin', { PHOTOPREP_HOME: 'relative-home' }, path.resolve('relative-home')],
    ];
    const platform = Object.getOwnPropertyDescriptor(process, 'platform'), homedir = os.homedir;
    const saved = ['PICPREP_HOME', 'PHOTOPREP_HOME', 'APPDATA', 'XDG_CONFIG_HOME'].map(k => [k, process.env[k]]);
    const results = [];
    for (const [plat, env, want] of cases) {
      Object.defineProperty(process, 'platform', { value: plat });
      os.homedir = () => HOME;
      for (const [k] of saved) delete process.env[k];
      Object.assign(process.env, env);
      try {
        results.push([plat, env, want, B.userDir(), appPaths ? require(appPaths).userDir() : null]);
      } finally {
        Object.defineProperty(process, 'platform', platform);
        os.homedir = homedir;
        for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
    for (const [plat, env, want, mine, app] of results) {
      const label = plat + (Object.keys(env).length ? ' with ' + Object.keys(env).join(', ') : '');
      check(mine === want, 'user folder on ' + label + ' is ' + want, mine);
      if (appPaths) check(mine === app, 'user folder on ' + label + ' equals the app\'s src/paths.js', { bridge: mine, app });
    }
    if (!appPaths) console.log('  --   no app checkout beside this repo (set PICPREP_SRC): checked against the app\'s known folders only');
  }

  // --- 1b. the folder from before the rename (photoprep) ------------------------------------------------
  // The app moves it to picprep on its first start since. Until then the bridge reads it there, and never makes the
  // new folder beside it (the app would keep that empty one). Both set to different values is refused, as the app does.
  {
    const B = require('../packages/picprep-mcp/bridge');
    const xdg = tmpHome();
    const saved = ['PICPREP_HOME', 'PHOTOPREP_HOME', 'XDG_CONFIG_HOME'].map(k => [k, process.env[k]]);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const dirFor = env => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      for (const [k] of saved) delete process.env[k];
      Object.assign(process.env, { XDG_CONFIG_HOME: xdg }, env);
      try { return B.userDir(); } catch (e) { return e; } finally {
        Object.defineProperty(process, 'platform', platform);
        for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    };
    fs.mkdirSync(path.join(xdg, 'photoprep'));   // the older folder
    check(dirFor({}) === path.join(xdg, 'photoprep'), 'with only the old photoprep folder, the bridge reads it', dirFor({}));
    check(!fs.existsSync(path.join(xdg, 'picprep')), 'and does not create the new picprep folder beside it');
    fs.mkdirSync(path.join(xdg, 'picprep'));
    check(dirFor({}) === path.join(xdg, 'picprep'), 'once the picprep folder exists, the bridge uses it', dirFor({}));
    const both = dirFor({ PICPREP_HOME: '/a', PHOTOPREP_HOME: '/b' });
    check(both instanceof Error && /set only one/.test(both.message), 'PICPREP_HOME and PHOTOPREP_HOME set differently is refused', both);
  }

  // --- 2. a running app, plain JSON answers ------------------------------------------------------------
  {
    const home = tmpHome();
    const app = await startFakeApp({ home, mode: 'json' });
    const direct = await app.direct([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    app.log.length = 0;
    const b = bridge({ PICPREP_HOME: home });
    const init = await b.call(1, 'initialize', INIT);
    check(init && same(init.result, direct[0].result), 'initialize answers what the app answers (instructions included)', init);
    b.send({ method: 'notifications/initialized' });
    const list = await b.call(2, 'tools/list');
    check(list && same(list.result, direct[1].result), 'tools/list is the app\'s own list, unchanged', list);
    const echo = await b.call(3, 'tools/call', { name: 'echo', arguments: { text: 'héllo' } });
    check(echo && echo.result && echo.result.content[0].text === '{"text":"héllo"}', 'a tool call reaches the app and its answer comes back', echo);
    const unknown = await b.call('x', 'resources/list');
    check(unknown && unknown.error && /method not found/.test(unknown.error.message), 'a method the app lacks gets the app\'s own error', unknown);
    const inits = app.log.filter(e => e.method === 'initialize');
    check(inits.length === 1 && same(inits[0].params, INIT), 'the app is initialized once, with the client\'s own parameters', inits);
    const calls = app.log.filter(e => e.method !== 'initialize');
    check(calls.length && calls.every(e => e.session && e.protocol === '2025-06-18'), 'every later message carries the session and protocol version', calls);
    check(app.log.filter(e => e.method === 'notifications/initialized').length === 1, 'the app hears notifications/initialized once', app.log.map(e => e.method));
    check(b.got.length === 4, 'notifications get no answer on stdout', b.got);
    const cache = JSON.parse(fs.readFileSync(path.join(home, 'state', 'mcp-catalogue.json'), 'utf8'));
    check(same(cache.tools, direct[1].result.tools) && same(cache.initialize, direct[0].result), 'the app\'s catalogue is kept for the next start');
    const code = await b.close();
    check(code === 0, 'the bridge exits cleanly when the client closes stdin', code);
    check(app.log.some(e => e.method === 'DELETE' && e.session === calls[0].session), 'and ends its session with the app (DELETE /mcp)', app.log.map(e => e.method));
    await app.stop();
  }

  // --- 3. a running app, answers as server-sent events -----------------------------------------------
  {
    const home = tmpHome();
    const app = await startFakeApp({ home, mode: 'sse' });
    const direct = await app.direct([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const b = bridge({ PICPREP_HOME: home });
    const init = await b.call(1, 'initialize', INIT);
    check(init && same(init.result, direct[0].result), 'event stream: initialize answers what the app answers', init);
    const list = await b.call(2, 'tools/list');
    check(list && same(list.result, direct[1].result), 'event stream: tools/list is the app\'s own list', list);
    const echo = await b.call(3, 'tools/call', { name: 'echo', arguments: { a: 1 } });
    check(echo && echo.result.content[0].text === '{"a":1}', 'event stream: a tool call comes back', echo);
    check(b.got.filter(m => m.method === 'notifications/progress').length >= 1, 'event stream: the app\'s progress notifications are passed on', b.got.map(m => m.method || m.id));
    await b.close();
    await app.stop();
  }

  // --- 4. calls do not wait on each other; a locked app's refusal reaches the assistant ---------------
  {
    const home = tmpHome();
    const app = await startFakeApp({ home, locked: true });
    const b = bridge({ PICPREP_HOME: home });
    await b.call(1, 'initialize', INIT);
    b.send({ id: 10, method: 'tools/call', params: { name: 'slow', arguments: { ms: 800 } } });
    b.send({ id: 11, method: 'tools/call', params: { name: 'echo', arguments: {} } });
    const first = await b.next(m => m.id === 10 || m.id === 11);
    check(first && first.id === 11, 'a quick call is answered while a slow one still waits', first);
    check(await b.next(byId(10)), 'and the slow one is answered too');
    // Node's shared HTTP agent drops a connection quiet for 5 s: a call that waits on the person (get_outcome
    // waitSec) was answered "lost the connection ... no answer within undefined ms".
    const long = await b.call(13, 'tools/call', { name: 'slow', arguments: { ms: 6500 } }, 12000);
    check(long && long.result && !long.result.isError && long.result.content[0].text === 'slow done', 'a call the app takes longer than 5 s to answer still comes back', long);
    const write = await b.call(12, 'tools/call', { name: 'propose', arguments: {} });
    check(write && write.result.isError && write.result.content[0].text === LICENCE_TEXT, 'a locked app\'s licence refusal reaches the assistant word for word', write);
    await b.close();
    await app.stop();
  }

  // --- 5. the app restarts under the bridge ------------------------------------------------------------
  {
    const home = tmpHome();
    let app = await startFakeApp({ home });
    const b = bridge({ PICPREP_HOME: home });
    await b.call(1, 'initialize', INIT);
    await app.stop();
    app = await startFakeApp({ home });   // a new port and token, no sessions
    const after = await b.call(2, 'tools/call', { name: 'echo', arguments: { again: true } });
    check(after && after.result && after.result.content[0].text === '{"again":true}', 'after the app restarts, the next call finds it and goes through', after || b.stderr());
    check(same(app.log.map(e => e.method), ['initialize', 'notifications/initialized', 'tools/call']), 'on a fresh session with the client\'s initialize replayed', app.log.map(e => e.method));
    app.forget();
    const forgotten = await b.call(3, 'tools/call', { name: 'echo', arguments: { b: 2 } });
    check(forgotten && forgotten.result && forgotten.result.content[0].text === '{"b":2}', 'when the app no longer knows the session (404), a new one is opened and the call goes through', forgotten);
    await b.close();
    await app.stop();
  }

  // --- 6. a refused token is reported, not retried forever ---------------------------------------------
  {
    const home = tmpHome();
    const app = await startFakeApp({ home, refuse: true });
    const b = bridge({ PICPREP_HOME: home });
    const r = await b.call(1, 'initialize', INIT);
    check(r && r.error && /HTTP 403/.test(r.error.message) && /forbidden/.test(r.error.message), 'an app that refuses the token is reported with its answer', r);
    const tool = await b.call(2, 'tools/call', { name: 'echo', arguments: {} });
    check(tool && tool.result && tool.result.isError && /HTTP 403/.test(tool.result.content[0].text), 'a tool call then answers with the reason as a tool error', tool);
    await b.close();
    await app.stop();
  }

  // --- 7. no app: said plainly ---------------------------------------------------------------------------
  {
    const home = tmpHome();
    // A state file left by an app that crashed: its port no longer answers.
    fs.mkdirSync(path.join(home, 'state'), { recursive: true });
    const dead = await startFakeApp({ home: tmpHome() });
    const deadPort = dead.port;
    await dead.stop();
    fs.writeFileSync(path.join(home, 'state', 'server.json'), JSON.stringify({ port: deadPort, token: 'gone', pid: 999999 }));
    const b = bridge({ PICPREP_HOME: home });
    const r = await b.call(1, 'initialize', INIT);
    check(r && r.error && /PicPrep is not installed on this computer/.test(r.error.message) && r.error.message.includes(NO_APP), 'with no app installed, initialize says so and where it looked', r);
    const tool = await b.call(2, 'tools/call', { name: 'echo', arguments: {} });
    check(tool && tool.result && tool.result.isError && /not installed/.test(tool.result.content[0].text), 'and a tool call answers the same as a tool error', tool);
    b.send('this is not json');
    const parse = await b.next(m => m.error && m.error.code === -32700);
    check(parse && parse.id === null, 'a line that is not JSON gets a parse error', parse);
    b.send('[1,2]');
    check(await b.next(m => m.error && m.error.code === -32600), 'a batch gets an invalid-request error');
    await b.close();
    const chk = spawnSync(process.execPath, [BIN, '--check'], { env: Object.assign({}, process.env, { PICPREP_HOME: home, PICPREP_APP: NO_APP }), encoding: 'utf8' });
    check(chk.status === 1 && /not installed/.test(chk.stdout), '--check says the app is not installed (exit 1)', chk.stdout + chk.stderr);
  }

  // --- 8. no app running: the bridge starts it -----------------------------------------------------------
  {
    const home = tmpHome();
    const b = bridge({ PICPREP_HOME: home, PICPREP_APP: launcher(home) });
    try {
      const r = await b.call(1, 'initialize', INIT, 35000);
      check(r && r.result && r.result.serverInfo && r.result.serverInfo.name === 'picprep', 'with no app running and none seen before, initialize starts it and answers from it', r || b.stderr());
      const launched = JSON.parse(fs.readFileSync(path.join(home, 'launched.json'), 'utf8'));
      check(launched.argv.includes('--launched-by=mcp') && launched.launchedBy === 'mcp', 'the app is told the assistant started it (--launched-by=mcp, PICPREP_LAUNCHED_BY=mcp)', launched);
      const chk = spawnSync(process.execPath, [BIN, '--check'], { env: Object.assign({}, process.env, { PICPREP_HOME: home }), encoding: 'utf8' });
      check(chk.status === 0 && /is running/.test(chk.stdout), '--check says the app is running', chk.stdout + chk.stderr);
      await b.close();
    } finally { b.kill(); killLaunched(home); }
  }

  // --- 9. no app running, seen before: answer from its catalogue, start it at the first call ------------
  {
    const home = tmpHome();
    const before = await startFakeApp({ home });   // last time: version 2.0.0
    const first = bridge({ PICPREP_HOME: home });
    await first.call(1, 'initialize', INIT);
    await first.call(2, 'tools/list');
    await first.close();
    await before.stop();
    // A client that does not wait for the initialize answer before listing the tools gets the catalogue too,
    // and the app is not started for it (here there is no app to start: starting it would be an error).
    {
      const hasty = bridge({ PICPREP_HOME: home });
      hasty.send({ id: 1, method: 'initialize', params: INIT });
      hasty.send({ id: 2, method: 'tools/list' });
      const l = await hasty.next(byId(2));
      check(l && l.result && same(l.result.tools, toolsFor()), 'tools/list sent before initialize was answered is answered from the catalogue as well', l);
      await hasty.close();
    }
    // Since then the app was updated (v2 adds a tool), and it is not running.
    const b = bridge({ PICPREP_HOME: home, PICPREP_APP: launcher(home), FAKE_APP_VARIANT: 'v2' });
    try {
      const init = await b.call(1, 'initialize', INIT);
      check(init && init.result && init.result.serverInfo.version === '2.0.0', 'initialize is answered from the catalogue the app left', init);
      b.send({ method: 'notifications/initialized' });
      const list = await b.call(2, 'tools/list');
      check(list && same(list.result.tools, toolsFor()), 'tools/list too', list);
      check(!fs.existsSync(path.join(home, 'launched.json')), 'and the app is not started just because a client connected');
      const call = await b.call(3, 'tools/call', { name: 'echo', arguments: { go: 1 } }, 35000);
      check(call && call.result && call.result.content[0].text === '{"go":1}', 'the first tool call starts the app and goes through', call || b.stderr());
      check(fs.existsSync(path.join(home, 'launched.json')), 'the app was started then');
      check(await b.next(m => m.method === 'notifications/tools/list_changed'), 'the client is told the updated app\'s tool list changed');
      const now = await b.call(4, 'tools/list');
      check(now && same(now.result.tools, toolsFor('v2')), 'and tools/list now gives the updated app\'s tools', now);
      const cache = JSON.parse(fs.readFileSync(path.join(home, 'state', 'mcp-catalogue.json'), 'utf8'));
      check(same(cache.tools, toolsFor('v2')) && cache.initialize.serverInfo.version === '2.1.0', 'the catalogue now holds the updated app\'s', cache.initialize.serverInfo);
      await b.close();
    } finally { b.kill(); killLaunched(home); }
  }
}

main().catch(e => { bad('crashed: ' + (e && e.stack || e)); }).finally(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' bridge check(s) failed' : '\nbridge checks passed');
  process.exit(failed ? 1 : 0);
});
