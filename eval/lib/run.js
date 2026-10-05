'use strict';
// One run of the eval: a fresh copy of a starting state, the app started on it with a window nobody sees, a fresh
// headless assistant given the person's words, and afterwards what the project on disk looks like.
//
//   runOne({ src, work, task, arm, n, iteration, model }) -> the run's folder, holding
//     transcript.md   what the assistant was told, each tool call with its arguments and answer, what it said
//     outputs/before.json, after.json   the projects on disk before and after, in short (digest below)
//     outputs/calls.json                every tool call: {tool, args, error, text}
//     timing.json     seconds, turns, cost, whether a turn was cut off
//
// Arm A (connector): the connector is the assistant's only MCP server and it has no other tool: all it knows of
//   PicPrep is what the app says in its instructions, tool descriptions and schemas.
// Arm B (plugin): the same, plus the skills, loaded as a plugin (this repo's .claude-plugin and skills/).
// Both: an empty working folder, no CLAUDE.md, no user settings, no memory, no other servers or plugins.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const BIN = path.join(REPO, 'packages', 'picprep-mcp', 'bin', 'picprep-mcp.js');
const LOCK = '/tmp/pp-flow.lock';          // one PicPrep window at a time on this machine, whoever started it
// The lock is shared with everyone testing the app on this machine. A batch holds it for about five minutes at the
// most: the whole conversation of a run gets BUDGET_MS (a turn still going then is cut off: nobody answers the app),
// and after giving the lock up the runner stays away for YIELD_MS, longer than the others' 20 s between tries, so
// whoever is waiting gets it first.
const BUDGET_MS = 240000;
const YIELD_MS = 50000;
const MAX_TURNS = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function calm() { for (let i = 0; i < 90 && os.loadavg()[0] >= 3; i++) await sleep(10000); }
let held = false;
const live = new Set();        // the apps this process started
let gaveUpAt = 0;
async function lock() {
  const since = Date.now() - gaveUpAt;
  if (since < YIELD_MS) await sleep(YIELD_MS - since);
  for (;;) { try { fs.mkdirSync(LOCK); held = true; return; } catch (e) { if (e.code !== 'EEXIST') throw e; await sleep(20000); } }
}
const unlock = () => { if (!held) return; held = false; gaveUpAt = Date.now(); try { fs.rmdirSync(LOCK); } catch (_) { /* not ours any more */ } };
// Stopped from outside: leave no app running and no lock behind.
const tidy = () => { for (const c of live) { try { process.kill(-c.pid, 'SIGKILL'); } catch (_) { /* gone */ } } for (const c of agents) { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } } unlock(); };
const agents = new Set();      // the assistants this process started
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { tidy(); process.exit(1); });
process.on('uncaughtException', e => { tidy(); console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { tidy(); console.error(e); process.exit(1); });
process.on('exit', tidy);

function get(port, p, token) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers: token ? { 'x-photoprep-token': token } : {}, timeout: 3000, agent: false }, res => {
      let t = ''; res.on('data', d => { t += d; }); res.on('end', () => { try { resolve(JSON.parse(t)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}

// The app from source, its window unseen. opens: [tab, folder] or [] for the home screen.
async function startApp(src, home, opens, wantProject) {
  const electron = require(path.join(src, 'node_modules', 'electron'));
  const env = Object.assign({}, process.env, { PICPREP_HOME: home, PICPREP_LICENSE_URL: 'http://127.0.0.1:9', PICPREP_TEST_KEYS: '1' });
  for (const k of ['ELECTRON_RUN_AS_NODE', 'PHOTOPREP_HOME', 'PHOTOPREP_TEST_KEYS', 'PHOTOPREP_LICENSE_URL']) delete env[k];
  const child = spawn(electron, [path.join(src, 'app', 'main.js'), ...opens, '--unseen'], { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  live.add(child); child.on('exit', () => live.delete(child));
  let err = ''; child.stderr.on('data', d => { err = (err + d).slice(-2000); });
  const stateFile = path.join(home, 'state', 'server.json');
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (child.exitCode !== null) throw new Error('the app exited (' + child.exitCode + '): ' + err);
    let s; try { s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { continue; }
    try {
      const hosts = await get(s.port, '/api/hosts', s.token);
      // A window on the home screen holds no project and is not listed: the server answering is what there is to wait for.
      if (Array.isArray(hosts) && (wantProject ? hosts.some(h => h.live && h.project) : true)) { await sleep(wantProject ? 1500 : 5000); return { child, port: s.port, token: s.token }; }
    } catch (_) { /* not up yet */ }
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* gone */ }
  throw new Error('the app did not show a window within 60 s: ' + err);
}
async function stopApp(a) {
  if (!a) return;
  try { process.kill(-a.child.pid, 'SIGTERM'); } catch (_) { /* gone */ }
  for (let i = 0; i < 20 && a.child.exitCode === null && a.child.signalCode === null; i++) await sleep(250);
  try { process.kill(-a.child.pid, 'SIGKILL'); } catch (_) { /* gone */ }
}

// The projects of a user folder, in short: what a person would see changed.
function digest(home) {
  const dir = path.join(home, 'projects'), out = [];
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, id, 'project.json');
    if (!fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const name = pid => (d.photos[pid] ? d.photos[pid].name : pid);
    const known = ['schema', 'id', 'name', 'rev', 'createdAt', 'updatedAt', 'folders', 'photos', 'select', 'posts', 'tabs', 'asks', 'offers', 'suggest', 'activity', 'comments', 'changes', 'assist', 'post', 'slides', 'takenOut', 'export'];
    out.push({
      id: d.id, name: d.name, folders: d.folders,
      photos: Object.values(d.photos).map(p => ({ id: p.id, name: p.name, verdict: p.verdict })),
      groups: d.select && d.select.groups ? Object.keys(d.select.groups) : [],
      posts: (d.posts || []).map(p => ({ id: p.id, name: p.name, destination: p.destination || null,
        slides: (p.slides || []).map((s, i) => Object.assign({ n: i + 1, id: s.id, kind: s.kind, photos: (s.sources || []).map(name) }, s.mark ? { mark: s.mark } : {}, s.layout ? { layout: s.layout.type || true } : {}, s.n ? { tiles: s.n } : {}, s.approved ? { approved: true } : {})) })),
      changes: (d.changes || []).map(c => ({ id: c.id, op: c.op, args: c.args, set: c.set, what: c.label, why: c.why, state: c.state, post: c.post })),
      questions: (d.asks || []).map(a => ({ id: a.id, kind: a.kind || 'text', question: a.question, options: a.options, about: a.about, state: a.state })),
      offers: (d.offers || []).map(o => ({ n: o.n, what: o.kind || (o.proposal && o.proposal.op && o.proposal.op.label), op: o.proposal && o.proposal.op && o.proposal.op.name, why: o.why || (o.proposal && o.proposal.why), state: o.state })),
      suggestions: Object.entries(d.suggest || {}).map(([k, v]) => ({ target: k, state: v.state, value: v.value })),
      other: Object.fromEntries(Object.keys(d).filter(k => !known.includes(k)).map(k => [k, d[k]])),
      rev: d.rev,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// What the assistant is started with, per arm. Returns the claude arguments after the prompt.
function armArgs(arm, runDir, home, model) {
  const server = { command: process.execPath, args: [BIN], env: { PICPREP_HOME: home, PICPREP_APP: path.join(home, 'not-installed', 'PicPrep') } };
  const common = ['--model', model, '--setting-sources', '', '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--permission-mode', 'dontAsk'];
  if (arm === 'connector') {
    const cfg = path.join(runDir, 'mcp.json');
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { picprep: server } }));
    return [...common, '--strict-mcp-config', '--mcp-config', cfg, '--tools', '', '--allowedTools', 'mcp__picprep'];
  }
  // The plugin as Claude Code loads it: its manifest and its skills. Its server entry is left out and the same local
  // connector given beside it (the entry runs `npx -y picprep-mcp`, which is not on npm yet), under --strict-mcp-config
  // so that no server of the person's account comes along.
  const plugin = path.join(runDir, 'plugin');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8'));
  delete manifest.mcpServers;
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));
  fs.cpSync(path.join(process.env.EVAL_SKILLS || path.join(REPO, 'skills')), path.join(plugin, 'skills'), { recursive: true });
  const cfg = path.join(runDir, 'mcp.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { picprep: server } }));
  return [...common, '--strict-mcp-config', '--mcp-config', cfg, '--plugin-dir', plugin, '--tools', 'Skill', '--allowedTools', 'mcp__picprep,Skill'];
}

// One turn: the person's words in, every event out. Resolves {events, cut}.
function turn(cwd, prompt, args, more, ms) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env); delete env.PICPREP_HOME; delete env.PHOTOPREP_HOME;
    const child = spawn('claude', ['-p', prompt, ...args, ...(more ? ['--continue'] : [])], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    agents.add(child); child.on('exit', () => agents.delete(child));
    const events = []; let buf = '', err = '', cut = false;
    child.stdout.on('data', d => { buf += d; for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { events.push(JSON.parse(l)); } catch (_) { /* not an event */ } } });
    child.stderr.on('data', d => { err = (err + d).slice(-1000); });
    const t = setTimeout(() => { cut = true; child.kill('SIGTERM'); }, ms);
    child.on('exit', () => { clearTimeout(t); resolve({ events, cut, err }); });
  });
}

const short = n => n.replace(/^mcp__(plugin_picprep_)?picprep__/, '');
function record(events, calls, lines) {
  const byId = new Map();
  for (const e of events) {
    if (e.type === 'assistant') for (const c of e.message.content || []) {
      if (c.type === 'text' && c.text.trim()) lines.push('**Assistant:** ' + c.text.trim(), '');
      if (c.type === 'tool_use') { const call = { tool: short(c.name), args: c.input }; byId.set(c.id, call); calls.push(call); }
    }
    if (e.type === 'user') for (const c of (Array.isArray(e.message.content) ? e.message.content : [])) {
      if (c.type !== 'tool_result') continue;
      const call = byId.get(c.tool_use_id); if (!call) continue;
      const parts = Array.isArray(c.content) ? c.content : [{ type: 'text', text: String(c.content) }];
      call.error = !!c.is_error;
      call.text = parts.map(p => (p.type === 'text' ? p.text : '[' + p.type + ']')).join('\n');
      const shown = call.tool === 'Skill' ? call.text.slice(0, 200) : call.text.length > 1500 ? call.text.slice(0, 1500) + ' ...[' + call.text.length + ' characters]' : call.text;
      lines.push('**Tool** `' + call.tool + '` ' + JSON.stringify(call.args), (call.error ? '**Refused:** ' : '**Answer:** ') + shown.replace(/\s+/g, ' '), '');
    }
  }
  const result = events.find(e => e.type === 'result');
  return result || null;
}

async function runOne({ src, work, task, arm, n, iteration, model = 'sonnet', locked = false }) {
  const runDir = path.join(work, 'iteration-' + iteration, task.name, arm, 'run-' + n);
  fs.rmSync(runDir, { recursive: true, force: true });
  const home = path.join(runDir, 'home'), cwd = path.join(runDir, 'cwd'), outputs = path.join(runDir, 'outputs');
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(outputs, { recursive: true });
  fs.cpSync(path.join(work, 'fixtures', task.fixture), home, { recursive: true });
  if (task.licence === 'none') fs.rmSync(path.join(home, 'license'), { recursive: true, force: true });
  if (task.app === 'off') { fs.mkdirSync(path.join(home, 'state'), { recursive: true }); fs.copyFileSync(path.join(work, 'catalogue.json'), path.join(home, 'state', 'mcp-catalogue.json')); }
  const before = digest(home);
  fs.writeFileSync(path.join(outputs, 'before.json'), JSON.stringify(before, null, 1));
  const lines = ['# ' + task.name + ' (' + arm + ', run ' + n + ')', ''], calls = [], timing = { seconds: 0, turns: 0, cost: 0, cut: false };
  const args = armArgs(arm, runDir, home, model);
  let app = null;
  const started = Date.now();
  if (task.app !== 'off' && !locked) { await calm(); await lock(); }
  try {
    if (task.app !== 'off') app = await startApp(src, home, task.app === 'home' ? [] : [task.tab || 'compose', path.join(work, 'photos', 'trip')], task.app !== 'home');
    for (const [i, said] of task.prompts.entries()) {
      const prompt = said.replace('{photos}', path.join(work, 'photos'));
      lines.push('**Person:** ' + prompt, '');
      const r = await turn(cwd, prompt, args, i > 0, Math.max(20000, BUDGET_MS - (Date.now() - started)));
      const result = record(r.events, calls, lines);
      if (i === 0) { const init = r.events.find(e => e.type === 'system' && e.subtype === 'init'); timing.init = init ? { tools: init.tools, mcp: init.mcp_servers, skills: init.skills, plugins: (init.plugins || []).map(p => p.name) } : null; }
      if (r.cut) { timing.cut = true; lines.push('*(cut off, ' + BUDGET_MS / 1000 + ' s into the run: the assistant was still waiting or working; it said nothing more)*', ''); break; }
      if (!result) { lines.push('*(the assistant ended with no answer: ' + r.err.trim().slice(-300) + ')*', ''); break; }
      timing.turns += result.num_turns || 0; timing.cost += result.total_cost_usd || 0;
      if (result.subtype !== 'success') lines.push('*(ended: ' + result.subtype + ')*', '');
    }
    await sleep(1500);   // the window saves what it applied
  } finally {
    await stopApp(app);
    if (task.app !== 'off' && !locked) unlock();
  }
  timing.seconds = Math.round((Date.now() - started) / 1000);
  // The session files a two-part conversation needs are ours alone: remove them.
  try { const sess = path.join(os.homedir(), '.claude', 'projects', fs.realpathSync(cwd).replace(/[^A-Za-z0-9]/g, '-')); if (sess.includes('iteration-')) fs.rmSync(sess, { recursive: true, force: true }); } catch (_) { /* none */ }
  fs.writeFileSync(path.join(outputs, 'after.json'), JSON.stringify(digest(home), null, 1));
  fs.writeFileSync(path.join(outputs, 'calls.json'), JSON.stringify(calls, null, 1));
  fs.writeFileSync(path.join(runDir, 'transcript.md'), lines.join('\n'));
  fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify(timing, null, 1));
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(path.join(runDir, 'plugin'), { recursive: true, force: true });
  return runDir;
}

module.exports = { runOne, digest, short, calm, lock, unlock };
