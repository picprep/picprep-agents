'use strict';
// The connector has no tool list of its own: it passes on the app's (packages/picprep-mcp/bridge.js). Everything
// else in this repo is written about those tools - the skills, the README - and that can drift. So:
//
//   1. test/fixtures/app-tools.json records the app's tools as this repo last saw them: each name, in order, with
//      its arguments and which are required. The README's list of tools and the skills are checked against it.
//   2. With a checkout of the app beside this repo (test/lib/app-src.js), the record is compared with the app's
//      own list (src/mcp.js TOOLS), and the connector is run over stdio against the app's real server, with no
//      window: what it lists must be the app's list exactly (names, descriptions, schemas, annotations), every
//      tool is called once, and the refusals a new user meets must be plain sentences.
//      Without the checkout (CI) part 2 says it was skipped.
//
// `node test/parity.js --write` rewrites the record from the app. Do it when the app's tools changed, then read
// the skills and the README against the change: a skill describing an argument that is gone is followed confidently.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { appSrc } = require('./lib/app-src');

const root = path.join(__dirname, '..');
const BIN = path.join(root, 'packages', 'picprep-mcp', 'bin', 'picprep-mcp.js');
const RECORD = path.join(__dirname, 'fixtures', 'app-tools.json');
let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };
const check = (cond, m, detail) => cond ? ok(m) : bad(m + (detail === undefined ? '' : ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = x => JSON.parse(JSON.stringify(x));
const shape = tools => tools.map(t => ({ name: t.name, args: Object.keys(t.inputSchema.properties), required: t.inputSchema.required || [] }));
const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

const src = appSrc();
const appTools = src ? plain(require(path.join(src, 'src', 'mcp.js')).TOOLS) : null;

if (process.argv.includes('--write')) {
  if (!appTools) { console.error('no app checkout beside this repo (set PICPREP_SRC): nothing to write the record from'); process.exit(1); }
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify({ note: 'The PicPrep app\'s assistant tools as this repo last saw them. Written by node test/parity.js --write; never by hand.', tools: shape(appTools) }, null, 2) + '\n');
  console.log('wrote ' + path.relative(root, RECORD) + ' (' + appTools.length + ' tools). Now read skills/ and README.md against the change.');
  process.exit(0);
}

const record = JSON.parse(fs.readFileSync(RECORD, 'utf8')).tools;
const names = record.map(t => t.name);

// --- 1. what this repo says about the tools -------------------------------------------------------------------
{
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const section = /\n## The tools\n([\s\S]*?)\n## /.exec(readme);
  check(section, 'the README has a section "The tools"');
  if (section) {
    const listed = [...section[1].matchAll(/^\| `([a-z_]+)` \|/gm)].map(m => m[1]);
    check(same(listed, names), 'the README lists the app\'s tools, each once, in the app\'s order', { readme: listed, app: names });
    check(new RegExp('\\b' + NUMBER[names.length] + ' tools\\b', 'i').test(section[1]), 'and says how many there are (' + NUMBER[names.length] + ')');
  }
  const skillsDir = path.join(root, 'skills');
  const skills = fs.readdirSync(skillsDir).map(d => path.join(skillsDir, d, 'SKILL.md')).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8'));
  const unmentioned = names.filter(n => !skills.some(s => new RegExp('`' + n + '\\b').test(s)));
  check(!unmentioned.length, 'every tool is used in at least one skill', unmentioned);
  // A count of tools written out in a skill or a note must be the real one ("the ten tools" outlives the tenth).
  const texts = [['README.md', readme], ...fs.readdirSync(skillsDir).map(d => ['skills/' + d, fs.readFileSync(path.join(skillsDir, d, 'SKILL.md'), 'utf8')]),
    ...fs.readdirSync(path.join(root, 'docs')).map(f => ['docs/' + f, fs.readFileSync(path.join(root, 'docs', f), 'utf8')])];
  const wrong = [];
  for (const [f, t] of texts) for (const m of t.matchAll(/\b(\d+|[a-z]+) (?:assistant |MCP )?tools\b/gi)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER.indexOf(m[1].toLowerCase());
    if (n > 1 && n !== names.length) wrong.push(f + ': "' + m[0] + '"');
  }
  check(!wrong.length, 'no page counts the tools wrongly', wrong);
}

// --- 2. against the app itself ----------------------------------------------------------------------------------
// The connector as an assistant runs it.
function connector(home) {
  const env = Object.assign({}, process.env, { PICPREP_HOME: home, PICPREP_APP: path.join(home, 'no-app') });
  delete env.PHOTOPREP_HOME; delete env.PHOTOPREP_APP;   // the older names: only one of each may be set
  const child = spawn(process.execPath, [BIN], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let seq = 0, stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch (_) { return bad('stdout carries only JSON-RPC, but got: ' + line); }
    const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
  });
  const rpc = (method, params) => new Promise(resolve => {
    const id = ++seq;
    const t = setTimeout(() => { waiting.delete(id); resolve({ error: { message: 'no answer to ' + method + ' within 20 s; stderr: ' + stderr } }); }, 20000);
    waiting.set(id, m => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  // A tool call: {error: true, text} or {data}.
  const tool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    if (!r.result) return { error: true, text: 'protocol error: ' + JSON.stringify(r.error) };
    const first = r.result.content[0];
    if (r.result.isError) return { error: true, text: first.text };
    return first.type === 'text' ? { data: JSON.parse(first.text) } : { data: r.result.content };
  };
  return { rpc, tool, stderr: () => stderr, close: () => new Promise(r => { child.on('exit', r); child.stdin.end(); }) };
}

// The app's real server in its own process, on a throwaway home (test/lib/real-app.js).
function realApp(home, licence) {
  const env = Object.assign({}, process.env, { PICPREP_HOME: home, PICPREP_LICENSE_URL: 'http://127.0.0.1:9' });
  delete env.PHOTOPREP_HOME; delete env.PHOTOPREP_LICENSE_URL;
  const child = spawn(process.execPath, [path.join(__dirname, 'lib', 'real-app.js'), src, licence], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { child.kill(); reject(new Error('the app\'s server did not start within 20 s: ' + err)); }, 20000);
    child.on('exit', code => { clearTimeout(t); reject(new Error('the app\'s server exited with code ' + code + ': ' + err)); });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      if (line !== 'READY') return;
      clearTimeout(t);
      resolve({ stop: () => new Promise(r => { child.removeAllListeners('exit'); child.on('exit', r); child.kill(); }) });
    });
  });
}

// A refusal an assistant can act on, and can repeat to the person: a sentence, not a stack trace or a bare status.
const actionable = t => typeof t === 'string' && t.length > 20 && !/\n\s+at |Error:|ECONNREFUSED|undefined|\[object/.test(t);

async function live() {
  check(same(shape(appTools), record), 'the record of the app\'s tools is current (else: node test/parity.js --write, then read the skills against the change)', { app: shape(appTools).filter((t, i) => !same(t, record[i])), record: record.filter((t, i) => !same(t, shape(appTools)[i])) });

  const temps = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'picprep-parity-')); temps.push(d); return d; };
  const sample = path.join(src, 'assets', 'sample');
  const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity-test', version: '1' } };

  // --- a licensed app, no window ---
  {
    const home = tmp(), app = await realApp(home, 'licensed'), c = connector(home);
    const init = await c.rpc('initialize', INIT);
    check(init.result && init.result.serverInfo.name === 'picprep' && /propose/.test(init.result.instructions || ''), 'through the connector, initialize is the app\'s (its name and instructions)', init);
    const list = await c.rpc('tools/list', {});
    const got = list.result ? list.result.tools : [];
    check(same(got.map(t => t.name), appTools.map(t => t.name)), 'the connector lists the app\'s ' + appTools.length + ' tools, in the app\'s order', got.map(t => t.name));
    for (const t of appTools) {
      const g = got.find(x => x.name === t.name) || {};
      check(same(g, t), t.name + ': description, input schema and annotations are the app\'s, unchanged', Object.keys(t).filter(k => !same(g[k], t[k])));
    }

    // Every tool once, as an assistant would use them on a new project.
    check(same((await c.tool('list_projects')).data, []), 'list_projects: a new copy has no projects');
    const opened = (await c.tool('open_project', { folder: sample })).data || {};
    check(opened.id && opened.windows === 0, 'open_project: the sample folder becomes a project (no window is open here)', opened);
    const project = (await c.tool('view', { what: 'project', project: opened.id })).data || {};
    const photos = project.photos || [];
    check(photos.length > 2 && photos.every(p => p.id && p.name), 'view: the project\'s photos by id and name', project);
    const shown = await c.tool('show_tab', { project: opened.id, tab: 'select' });
    check(shown.error && /PicPrep has no window open. Ask the person to open PicPrep/.test(shown.text) && actionable(shown.text), 'show_tab: with no window open, says so and to ask the person to open it', shown);
    const on = (await c.tool('status', { project: opened.id, working: true, note: 'Checking the tools' })).data;
    check(on && on.working === true && on.note === 'Checking the tools', 'status: at work, with the note', on);
    const asked = (await c.tool('ask', { project: opened.id, question: 'Which of these is the cover?' })).data || {};
    check(asked.askId, 'ask: gives an askId', asked);
    const pending = (await c.tool('get_outcome', { project: opened.id, askId: asked.askId })).data;
    check(pending && pending.pending === true, 'get_outcome: the question waits for the person', pending);
    const chosen = (await c.tool('choose', { project: opened.id, question: 'Portrait or square?', options: ['Portrait', 'Square'] })).data || {};
    check(chosen.askId, 'choose: gives an askId', chosen);
    const taken = (await c.tool('withdraw', { project: opened.id, askId: chosen.askId })).data;
    check(taken && taken.withdrawn === 'ask', 'withdraw: takes the open question back', taken);

    // A named change: applied by PicPrep itself (no window here), and marked as the assistant's, with its reason.
    const why = 'Soft focus: worth a second look';
    const proposed = (await c.tool('propose', { project: opened.id, why, changes: [{ op: 'select.mark', args: { photos: [photos[0].id], as: 'maybe' } }] })).data || {};
    check(proposed.proposalId && (proposed.changes || []).length === 1, 'propose: a named change is taken', proposed);
    // waitSec 6: the app holds the call that long, since nobody reviews the change here (longer than the 5 s after which Node's shared HTTP agent drops a quiet connection).
    const outcome = (await c.tool('get_outcome', { project: opened.id, proposalId: proposed.proposalId, waitSec: 6 })).data || {};
    const change = (outcome.changes || [])[0] || {};
    check(change.state === 'applied' && outcome.answered === false, 'the change is applied, and waits for the person to keep or reject it', outcome);
    const after = (await c.tool('view', { what: 'project', project: opened.id })).data || {};
    check((after.photos || []).some(p => p.id === photos[0].id && p.verdict === 'maybe'), 'the project shows it (the photo is marked Maybe)');
    check(after.assistant && same(after.assistant.unreviewed.map(u => u.id), [change.id]), 'and lists it as the assistant\'s change, not yet reviewed', after.assistant);
    const full = (await c.tool('view', { what: 'project', project: opened.id, detail: 'full' })).data || {};
    const stored = (full.changes || []).find(x => x.id === change.id) || {};
    check(stored.why === why, 'the stored change carries the assistant\'s reason', stored);
    // Only the person keeps a change: no tool does, and the op list offers none that would.
    const ops = ((await c.tool('view', { what: 'ops' })).data || {}).ops || [];
    check(ops.length > 20 && !ops.some(o => /^(change|changes)\.(keep|reject|approve)/.test(o)), 'no op keeps, rejects or approves a change (only the person does)');
    check(!appTools.some(t => /keep|approve|export|delete|settings/i.test(t.name)), 'and no tool keeps, approves, exports, deletes or changes settings');
    const undone = (await c.tool('withdraw', { project: opened.id, proposalId: proposed.proposalId })).data || {};
    check(undone.ok && (undone.changes || []).length === 1, 'withdraw: an unreviewed change is undone', undone);
    const off = (await c.tool('status', { project: opened.id, working: false })).data;
    check(off && off.working === false, 'status: done', off);

    // The refusals a new user meets, each a sentence that says what to do.
    const noWindow = await c.tool('view', { what: 'project' });
    check(noWindow.error && /no PicPrep window has a project open/.test(noWindow.text) && /Pass project/.test(noWindow.text) && actionable(noWindow.text), 'no project open in a window: view says so and what to pass', noWindow);
    const shot = await c.tool('view_screenshot', { project: opened.id, target: 'window' });
    check(shot.error && actionable(shot.text), 'view_screenshot with no window open is refused in a sentence', shot);
    const unknown = await c.tool('view', { what: 'project', project: 'No such project' });
    check(unknown.error && /no project "No such project"; the projects are sample/.test(unknown.text), 'a project that does not exist: the projects there are are named', unknown);
    const badArg = await c.tool('status', { project: opened.id, working: true, note: 'x'.repeat(61) });
    check(badArg.error && /60/.test(badArg.text) && actionable(badArg.text), 'a note too long: status says what is accepted', badArg);
    const notATool = await c.tool('keep_change', {});
    check(notATool.error && /unknown tool: keep_change; the tools are/.test(notATool.text), 'a tool that does not exist: the tools there are are named', notATool);

    // PicPrep quits (and is not installed where the connector looks): the next call says so.
    await app.stop();
    const gone = await c.tool('list_projects');
    check(gone.error && /PicPrep is not installed on this computer \(looked for .*\)\. Install it, open it once, then try again\./.test(gone.text) && actionable(gone.text), 'PicPrep not running and not installed: the call says so, where it looked and what to do', gone);
    check(!/\n\s+at /.test(c.stderr()), 'and no stack trace is written anywhere', c.stderr());
    await c.close();
  }

  // --- a copy with no licence or trial (viewing only) ---
  {
    const home = tmp(), app = await realApp(home, 'unlicensed'), c = connector(home);
    await c.rpc('initialize', INIT);
    const opened = await c.tool('open_project', { folder: sample });
    check(opened.data && opened.data.id, 'viewing only: a project still opens', opened);
    const seen = await c.tool('view', { what: 'project', project: opened.data && opened.data.id });
    check(seen.data && seen.data.photos.length > 2, 'viewing only: the tools that only look still answer', seen);
    for (const [name, args] of [['propose', { why: 'x', changes: [{ op: 'select.mark', args: { photos: [seen.data.photos[0].id], as: 'maybe' } }] }], ['ask', { question: 'Which one?' }], ['status', { working: true }]]) {
      const r = await c.tool(name, Object.assign({ project: opened.data.id }, args));
      check(r.error && /^PicPrep needs a subscription or an active trial \(.+\)\. Only the person can enter one, in Settings → Licence\.$/.test(r.text), 'viewing only: ' + name + ' says a subscription or trial is needed, and that only the person can enter one', r);
    }
    const still = await c.tool('view', { what: 'project', project: opened.data.id });
    check(still.data && still.data.photos.every(p => p.verdict === 'untouched') && !still.data.assistant.unreviewed.length, 'and nothing in the project changed');
    await c.close();
    await app.stop();
  }
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
}

(src ? live() : Promise.resolve(console.log('  --   no app checkout beside this repo (set PICPREP_SRC): the connector was not run against the app'))).catch(e => bad('parity check crashed: ' + (e && e.stack || e))).finally(() => {
  console.log(failed ? '\n' + failed + ' parity check(s) failed' : '\nthe tools this repo describes are the app\'s');
  process.exit(failed ? 1 : 0);
});
