'use strict';
// A stand-in for the PicPrep app, as far as the bridge can see it: the state file, GET /health and
// MCP over Streamable HTTP at POST /mcp behind the session token (the app's contract,
// specs/005-licensing-distribution/contracts/app-license.md "Assistant"). It never touches a real
// user folder: the caller always gives it a throwaway PICPREP_HOME.
//
// Used two ways: required (startFakeApp) for an app that is already running, and run as a script
// (`node fake-app.js`, through PICPREP_APP) for an app the bridge has to start itself.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const LICENCE_TEXT = 'PicPrep needs a licence or an active trial (trial ended). Only the person can enter one, in Settings → Licence.';

function toolsFor(variant) {
  const tools = [
    { name: 'list_projects', description: 'The projects.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'echo', description: 'Returns its arguments.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'slow', description: 'Answers after ms milliseconds.', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } },
    { name: 'propose', description: 'A write tool.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
  ];
  // "v2" stands for an app update that added a tool.
  if (variant === 'v2') tools.push({ name: 'choose', description: 'Added in a later version.', inputSchema: { type: 'object', properties: {} } });
  return tools;
}

// opts: home (required), mode 'json' | 'sse', locked (licence refusals for write tools), variant,
// port (to come back on the same port), refuse (403 to every /mcp call, as for a token it does not accept).
function startFakeApp(opts) {
  const home = opts.home;
  const mode = opts.mode || 'json';
  const token = crypto.randomBytes(16).toString('hex');
  const sessions = new Set();
  const log = [];          // every /mcp request: {method, session, protocol, token}
  const version = opts.variant === 'v2' ? '2.1.0' : '2.0.0';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, app: 'picprep', version }));
      }
      if (req.headers['x-photoprep-token'] !== token || opts.refuse) { res.writeHead(403); return res.end('forbidden'); }
      if (req.url !== '/mcp') { res.writeHead(404); return res.end('not found'); }
      const sid = req.headers['mcp-session-id'];
      if (req.method === 'DELETE') { sessions.delete(sid); log.push({ method: 'DELETE', session: sid }); res.writeHead(200); return res.end(); }
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      if (!/application\/json/.test(req.headers.accept || '') || !/text\/event-stream/.test(req.headers.accept || '')) { res.writeHead(406); return res.end('accept both application/json and text/event-stream'); }
      let msg;
      try { msg = JSON.parse(body); } catch (_) { res.writeHead(400); return res.end('not JSON'); }
      log.push({ method: msg.method || 'reply', id: msg.id, session: sid, protocol: req.headers['mcp-protocol-version'], params: msg.params });

      if (msg.method === 'initialize') {
        const id = crypto.randomUUID();
        sessions.add(id);
        const want = msg.params && msg.params.protocolVersion;
        return answer(res, msg.id, {
          protocolVersion: ['2025-06-18', '2025-11-25'].includes(want) ? want : '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'picprep', version },
          instructions: 'Fake PicPrep ' + version + ' instructions.',
        }, { 'mcp-session-id': id });
      }
      if (!sid) { res.writeHead(400); return res.end('no session'); }
      if (!sessions.has(sid)) { res.writeHead(404); return res.end('unknown session'); }
      if (msg.id === undefined || !msg.method) { res.writeHead(202); return res.end(); }   // notifications and replies
      if (msg.method === 'tools/list') return answer(res, msg.id, { tools: toolsFor(opts.variant) });
      if (msg.method === 'ping') return answer(res, msg.id, {});
      if (msg.method === 'tools/call') {
        const name = msg.params && msg.params.name, args = (msg.params && msg.params.arguments) || {};
        if (name === 'echo') return answer(res, msg.id, text(JSON.stringify(args)));
        if (name === 'slow') return setTimeout(() => answer(res, msg.id, text('slow done')), args.ms || 0);
        if (name === 'propose') return answer(res, msg.id, opts.locked ? Object.assign(text(LICENCE_TEXT), { isError: true }) : text('proposed'));
        if (name === 'list_projects') return answer(res, msg.id, text('[]'));
        return answer(res, msg.id, Object.assign(text('unknown tool: ' + name), { isError: true }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } }));
    });
  });

  const text = t => ({ content: [{ type: 'text', text: t }] });
  function answer(res, id, result, headers) {
    const msg = { jsonrpc: '2.0', id, result };
    if (mode === 'sse') {
      res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream' }, headers));
      // A progress notification first, split over two writes, as a real stream may arrive.
      const progress = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p', progress: 1 } });
      res.write('event: message\ndata: ' + progress.slice(0, 20));
      res.write(progress.slice(20) + '\n\n');
      return res.end('event: message\r\ndata: ' + JSON.stringify(msg) + '\r\n\r\n');
    }
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, headers));
    res.end(JSON.stringify(msg));
  }

  const stateFile = path.join(home, 'state', 'server.json');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const port = server.address().port;
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ port, token, pid: process.pid }));
      resolve({
        port, token, log, version,
        forget: () => sessions.clear(),   // as if the app dropped every session (restarted on the same port and token)
        // What a client sees when it talks to the app's /mcp directly, for comparing with the bridge.
        direct: async msgs => {
          let session = null;
          const out = [];
          for (const m of msgs) {
            const r = await fetch('http://127.0.0.1:' + port + '/mcp', {
              method: 'POST', body: JSON.stringify(m),
              headers: Object.assign({ 'x-photoprep-token': token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, session ? { 'mcp-session-id': session } : {}),
            });
            if (r.headers.get('mcp-session-id')) session = r.headers.get('mcp-session-id');
            const t = await r.text();
            if (!t) continue;
            if (mode === 'json') out.push(JSON.parse(t));
            else for (const line of t.split(/\r?\n/)) if (line.startsWith('data: ') && line.includes('"id"')) out.push(JSON.parse(line.slice(6)));
          }
          return out;
        },
        stop: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); try { fs.unlinkSync(stateFile); } catch (_) { /* already gone */ } }),
      });
    });
  });
}

module.exports = { startFakeApp, toolsFor, LICENCE_TEXT };

// As a script: an app the bridge started. It records how it was started, then serves until killed.
if (require.main === module) {
  const home = process.env.PICPREP_HOME || process.env.PHOTOPREP_HOME;
  if (!home) { process.stderr.write('fake-app: PICPREP_HOME is not set\n'); process.exit(2); }
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'launched.json'), JSON.stringify({ argv: process.argv.slice(2), launchedBy: process.env.PICPREP_LAUNCHED_BY || null }));
  startFakeApp({ home, mode: process.env.FAKE_APP_MODE || 'json', variant: process.env.FAKE_APP_VARIANT });
}
