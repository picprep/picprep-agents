'use strict';
// The personal-assistant evaluation (specs/010 FR-110, T037): four scripted people, each talking to a real Claude
// Code session that works in an assistant folder made from the template, with the PicPrep connector as its only
// server. One conversation per run, continued turn by turn with --resume, so the memory files and the model's context
// behave as they would for a person. Scored mechanically from the files and the app's projects (personas.js).
// Claude Code only: no other vendor's CLI is run.
//
//   node eval/assistant/eval.js --dry                         everything but claude: fixtures, assistant creation, scoring
//   node eval/assistant/eval.js [--runs 2] [--personas a,b]   the real run (starts Claude Code sessions: costs; ask first)
//     --runs N sets every persona's runs; --runs 2,compaction=3 sets a default and some personas'; without --runs each
//     persona runs its own number (personas.js `runs`, compaction 3) or 2.
//
// Everything it makes lives in one temporary folder and the sessions' files under ~/.claude/projects; both are removed
// when it ends, however it ends. Results go to stdout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const R = require('../lib/run');
const { build, handMark } = require('./setup');
const { personas, readProject, readMemory, captionTells, median, CAPTIONS, body } = require('./personas');

const REPO = path.join(__dirname, '..', '..');
const BIN = path.join(REPO, 'packages', 'picprep-mcp', 'bin', 'picprep-mcp.js');
const RUN_MS = 8 * 60 * 1000;          // a run longer than this is stopped and recorded as a timeout
const MAX_TURNS_PER_MESSAGE = 30;
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const SRC = path.resolve(opt('src', path.join(REPO, '..', 'picprep')));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-assist-eval-'));
const sessionDirs = new Set();
const cleanup = () => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* reported by the caller's ls */ }
  for (const d of sessionDirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* idem */ }
};
process.on('exit', cleanup);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit(1));   // run.js's handlers stop apps and assistants on exit

// ---------- one message to Claude Code ----------
function say(cwd, mcpCfg, prompt, sid, ms) {
  return new Promise(resolve => {
    const args = ['-p', prompt, '--model', 'sonnet', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose',
      '--max-turns', String(MAX_TURNS_PER_MESSAGE), '--permission-mode', 'dontAsk', '--max-budget-usd', '3',
      '--strict-mcp-config', '--mcp-config', mcpCfg, '--tools', 'Read,Write,Edit,Glob,Grep,Skill',
      '--allowedTools', 'mcp__picprep,Skill,Read,Write,Edit,Glob,Grep'];
    if (sid) args.push('--resume', sid);
    const env = Object.assign({}, process.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }); delete env.PICPREP_HOME; delete env.PHOTOPREP_HOME;
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    R.agents.add(child); child.on('exit', () => R.agents.delete(child));
    const events = []; let buf = '', err = '', cut = false;
    child.stdout.on('data', d => { buf += d; for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { events.push(JSON.parse(l)); } catch (_) { /* not an event */ } } });
    child.stderr.on('data', d => { err = (err + d).slice(-1000); });
    const t = setTimeout(() => { cut = true; child.kill('SIGTERM'); }, ms);
    child.on('exit', () => { clearTimeout(t); resolve({ events, cut, err }); });
  });
}

function snapshot(fx) {
  const projects = {};
  for (const [name, p] of Object.entries(fx.projects)) projects[name] = readProject(fx.home, p.id);
  return { memory: readMemory(fx.assistant), projects };
}

// ---------- one conversation ----------
async function runOne(name, n) {
  const persona = personas[name], dir = path.join(root, name + '-' + n);
  fs.mkdirSync(dir, { recursive: true });
  const fx = await build(SRC, dir);
  persona.seed(fx.assistant);
  const mcpCfg = path.join(dir, 'mcp.json');
  fs.writeFileSync(mcpCfg, JSON.stringify({ mcpServers: { picprep: { command: process.execPath, args: [BIN], env: { PICPREP_HOME: fx.home, PICPREP_APP: path.join(fx.home, 'not-installed', 'PicPrep') } } } }));
  sessionDirs.add(path.join(os.homedir(), '.claude', 'projects', fs.realpathSync(fx.assistant).replace(/[^A-Za-z0-9]/g, '-')));
  const run = { persona: name, n, turns: [], questionsBeforeWork: 0, sawPropose: false, compacted: false, timeout: false, cost: 0, seconds: 0, claudeTurns: 0 };
  const snaps = [], said = [];
  let app = null, sid = null;
  const started = Date.now();
  await R.calm(); await R.lock();
  try {
    app = await R.startApp(SRC, fx.home, ['compose', fx.projects['Post A'].folder], true);
    for (let guard = 0; guard < 9; guard++) {
      let prompt = persona.next(snaps, said);
      if (prompt == null) break;
      if (typeof prompt === 'object') {
        // The person acts in PicPrep before they write: the app is stopped, a window-side server on the same folder moves
        // the mark, and the app is started again, so the change is the person's own edit, not the assistant's.
        await R.stopApp(app); app = null;
        await handMark(SRC, fx, prompt.mark.post, prompt.mark.corner);
        app = await R.startApp(SRC, fx.home, ['compose', fx.projects['Post A'].folder], true);
        prompt = prompt.say;
      }
      said.push(prompt);
      const left = RUN_MS - (Date.now() - started);
      if (left < 20000) { run.timeout = true; break; }
      const r = await say(fx.assistant, mcpCfg, prompt, sid, left);
      const init = r.events.find(e => e.type === 'system' && e.subtype === 'init');
      if (init && !run.init) {
        run.init = { skills: init.skills, mcp: init.mcp_servers, tools: init.tools.filter(t => !t.startsWith('mcp__picprep__')) };
        if (!(init.skills || []).some(s => /picprep-onboard/.test(s))) throw new Error('the assistant folder\'s skills were not loaded (skills: ' + JSON.stringify(init.skills) + ')');
        if (!(init.mcp_servers || []).some(s => s.name === 'picprep' && s.status === 'connected')) throw new Error('the connector did not connect: ' + JSON.stringify(init.mcp_servers));
      }
      const texts = [];
      for (const e of r.events) {
        if (e.type === 'assistant') for (const c of e.message.content || []) {
          if (c.type === 'text' && c.text.trim()) { texts.push(c.text.trim()); if (!run.sawPropose) run.questionsBeforeWork += (c.text.match(/\?/g) || []).length; }
          if (c.type === 'tool_use' && /propose$/.test(c.name)) run.sawPropose = true;
        }
        if (e.compact_result === 'success') run.compacted = true;
      }
      const result = r.events.find(e => e.type === 'result');
      sid = (result && result.session_id) || (init && init.session_id) || sid;
      run.cost += (result && result.total_cost_usd) || 0; run.claudeTurns += (result && result.num_turns) || 0;
      run.turns.push({ said: prompt.slice(0, 80), replied: texts.join(' ').slice(0, 200), ended: result ? result.subtype : r.cut ? 'cut' : 'no result: ' + r.err.trim().slice(-200) });
      await R.sleep(2000);   // the app saves what it applied
      snaps.push(snapshot(fx));
      if (r.cut) { run.timeout = true; break; }
      if (!result && !(prompt === '/compact' && run.compacted)) break;
    }
  } finally {
    await R.stopApp(app);
    R.unlock();
  }
  run.seconds = Math.round((Date.now() - started) / 1000);
  run.checks = snaps.length ? persona.score(snaps, run) : [{ what: 'a conversation took place', ok: false, why: 'no turn completed' }];
  run.memoryAtEnd = snaps.length ? Object.fromEntries(Object.entries(snaps[snaps.length - 1].memory).filter(([f, t]) => body(t)).map(([f, t]) => [f, body(t).slice(0, 700)])) : {};
  return run;
}

// ---------- the dry run ----------
async function dry() {
  let ok = 0, bad = 0;
  const check = (what, pass, why) => { if (pass) ok++; else bad++; console.log((pass ? '  ok   ' : '  FAIL ') + what + (pass ? '' : ' -- ' + why)); };
  const M = require(path.join(SRC, 'src', 'mcp.js'));
  const fxs = {};
  for (const name of Object.keys(personas)) {
    const dir = path.join(root, 'dry-' + name);
    fs.mkdirSync(dir, { recursive: true });
    const fx = fxs[name] = await build(SRC, dir);
    personas[name].seed(fx.assistant);
    const has = f => fs.existsSync(path.join(fx.assistant, f));
    check(name + ': assistant folder made by the app with its skills and CLAUDE.md', has('CLAUDE.md') && has('AGENTS.md') && has('.agents/skills/picprep-onboard/SKILL.md') && has('.agents/skills/picprep-caption/SKILL.md') && has('.claude/skills/picprep-onboard/SKILL.md') && has('.picprep/template.json'), fx.assistant);
    check(name + ': five projects, three photos each, no change of the assistant on file', Object.values(fx.projects).length === 5 && Object.keys(fx.projects).every(k => { const p = readProject(fx.home, fx.projects[k].id); return p.slides === 3; }), JSON.stringify(Object.keys(fx.projects)));
    const mem = readMemory(fx.assistant);
    const seeded = { 'repeat-correction': 0, 'one-off': 0, 'caption-voice': 12, compaction: 3 }[name];
    const n = name === 'compaction' ? body(mem['preferences.md']).split('\n').filter(l => l.startsWith('- ')).length : name === 'caption-voice' ? body(mem['captions.md']).split('\n').length : body(mem['about.md']).length;
    check(name + ': memory seeded as the persona starts (' + seeded + ')', name === 'repeat-correction' || name === 'one-off' ? n === 0 : n === seeded, 'got ' + n);
  }
  // The app on a fixture, and what the connector files, read back by the scorers.
  const fx = fxs.compaction;
  const lockWait = await R.calm(); await R.lock();
  let app;
  try {
    app = await R.startApp(SRC, fx.home, ['compose', fx.projects['Post A'].folder], true);
    const handle = M.createHandler({ http: M.httpVia(async () => ({ port: app.port, token: app.token })), log: () => {} });
    let id = 0;
    const tool = async (name, args) => { const r = await handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); if (r.result.isError) throw new Error(name + ': ' + r.result.content[0].text); return JSON.parse(r.result.content[0].text); };
    const B = fx.projects['Post B'].id, A = fx.projects['Post A'].id;
    const view = await tool('view', { what: 'project', project: B });
    const mark = anchor => ({ on: true, id: 'sample-dark', place: 'anchor', anchor, insX: 5, insY: 5, fx: 0.85, fy: 0.85, sizePct: 22, op: 0.55 });
    await tool('propose', { project: B, tab: 'watermark', why: 'dry run', set: view.slides.map(s => ({ target: '/slides/' + s.id + '/mark', value: mark('br') })) });
    await tool('propose', { project: B, tab: 'export', why: 'dry run', set: [{ target: '/export/caption', value: 'quiet harbour, early light' }, { target: '/export/overrides/metadata', value: 'keep-no-gps' }] });
    const viewA = await tool('view', { what: 'project', project: A });
    await tool('propose', { project: A, tab: 'watermark', why: 'dry run', set: viewA.slides.map(s => ({ target: '/slides/' + s.id + '/mark', value: mark('br') })) });
    await R.sleep(2000);
    const p = readProject(fx.home, B);
    check('reader: marks bottom right on every slide read back', p.allBr && p.marked === 3, JSON.stringify(p));
    check('reader: the caption filed to /export/caption read back', p.caption === 'quiet harbour, early light', JSON.stringify(p.caption));
    check('reader: the metadata choice read back', p.metadata === 'keep-no-gps', JSON.stringify(p.metadata));
    const snap = snapshot(fx);
    const good = personas.compaction.score([snap, snap, snap, snap], { compacted: true });
    check('compaction scorer: all five pass on a canned good run', good.every(c => c.ok === true), JSON.stringify(good.filter(c => c.ok !== true)));
    const bare = readProject(fx.home, fx.projects['Post C'].id);
    check('reader: an untouched project has no mark, caption or setting', bare.marked === 0 && bare.caption === null && bare.metadata === null && !bare.allBr, JSON.stringify(bare));
  } finally { await R.stopApp(app); R.unlock(); }
  // Scorers on canned files, no app.
  const memOf = o => Object.fromEntries(Object.entries(o).map(([f, t]) => [f, '<!-- c -->\n' + t]));
  const proj = (o = {}) => Object.assign({ slides: 3, marked: 3, corners: { br: 3 }, allBr: true, allTl: false, caption: null, metadata: null }, o);
  const snapOf = (projects, memory) => ({ projects, memory: memOf(memory) });
  {
    const TL = { allBr: false, allTl: true, corners: { tl: 3 } }, BR = { allBr: true, allTl: false, corners: { br: 3 } };
    const mem = { 'about.md': 'Travel photos on Instagram, English, wants marks and captions help (their words, Oct 2026)', 'preferences.md': '- Mark: top left on every slide (they moved it by hand on two posts, Oct 2026)' };
    const good = snapOf({ 'Post A': proj(BR), 'Post B': proj(BR), 'Post C': proj(TL), 'Post D': proj(TL) }, mem);
    const r = personas['repeat-correction'].score([good], { questionsBeforeWork: 2 });
    check('repeat-correction scorer: passes a remembered run', r.filter(c => c.ok !== null).every(c => c.ok), JSON.stringify(r.filter(c => c.ok === false)));
    const forgot = snapOf({ 'Post C': proj(BR), 'Post D': proj(BR) }, { 'about.md': '' });
    const r2 = personas['repeat-correction'].score([forgot], { questionsBeforeWork: 5 });
    check('repeat-correction scorer: fails a forgetful run on every count', r2.filter(c => c.ok !== null).every(c => !c.ok), JSON.stringify(r2));
    const late = [snapOf({ 'Post C': proj(BR) }, { 'about.md': mem['about.md'] }), good];
    check('repeat-correction scorer: memory written only after Post C does not count as "by the third post"', personas['repeat-correction'].score(late, { questionsBeforeWork: 1 })[0].ok === false, '');
    const said = [], snaps = [];
    const say1 = () => { const t = personas['repeat-correction'].next(snaps, said); if (t) said.push(typeof t === 'string' ? t : t.say); return t; };
    say1(); snaps.push(snapOf({}, {})); say1();
    snaps.push(snapOf({ 'Post A': proj(BR) }, {}));
    const b = say1();
    check('repeat-correction script: after Post A is marked elsewhere than top left, the person moves it by hand, then asks for Post B', b && b.mark && b.mark.post === 'Post A' && b.mark.corner === 'tl' && /Post B/.test(b.say) && !/remember|top left|always/i.test(b.say), JSON.stringify(b));
    snaps.push(snapOf({ 'Post A': proj(BR), 'Post B': proj(TL) }, {}));
    const c = say1();
    check('repeat-correction script: moves nothing when the mark is already top left', typeof c === 'string' && /Post C/.test(c), JSON.stringify(c));
    snaps.push(snapOf({ 'Post C': proj(TL) }, {}));
    const d = say1();
    check('repeat-correction script: asks for Post D, then ends', typeof d === 'string' && /Post D/.test(d), JSON.stringify(d));
    snaps.push(snapOf({ 'Post D': proj(TL) }, {}));
    check('repeat-correction script: ends after Post D', say1() === null, '');
    check('compaction runs 3 times by default', personas.compaction.runs === 3, String(personas.compaction.runs));
  }
  {
    const habit = snapOf({ 'Post A': proj({ marked: 0 }), 'Post B': proj() }, { 'preferences.md': '- No watermark on trips (they said leave it off, Oct 2026)' });
    check('one-off scorer: fails a one-off kept as a habit', personas['one-off'].score([habit])[0].ok === false, '');
    const clean = snapOf({ 'Post A': proj({ marked: 0 }), 'Post B': proj() }, { 'preferences.md': '- Captions short. (Oct 2026)' });
    check('one-off scorer: passes when nothing was kept', personas['one-off'].score([clean]).filter(c => c.ok !== null).every(c => c.ok), '');
  }
  {
    const tells = ['a hidden gem — pure magic', 'Sunrise over the bay #travel', 'what a journey?', 'not just a view, but a feeling', 'one two 🌊🌊'];
    check('caption tells: each bad caption is caught', tells.every(t => captionTells(t).length), JSON.stringify(tells.map(captionTells)));
    check('caption tells: their own captions pass', CAPTIONS.every(c => captionTells(c).length === 0), JSON.stringify(CAPTIONS.filter(c => captionTells(c).length)));
    const mk = c => snapOf(Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(l => ['Post ' + l, proj({ caption: c })])), {});
    const med = median(CAPTIONS.map(c => c.length));
    const okc = personas['caption-voice'].score([mk('low tide, quiet harbour')]);
    check('caption-voice scorer: passes plain captions (median ' + med + ')', okc.filter(c => c.ok !== null).every(c => c.ok), JSON.stringify(okc));
    const badc = personas['caption-voice'].score([mk('Stunning light over the bay — a journey I will not forget. ' + 'x'.repeat(100) + ' #travel')]);
    check('caption-voice scorer: fails tells and length', badc.filter(c => c.ok !== null).slice(1).every(c => !c.ok), JSON.stringify(badc));
  }
  console.log('\ndry run: ' + ok + ' checks passed, ' + bad + ' failed');
  return bad ? 1 : 0;
}

// ---------- the real run ----------
async function real() {
  const names = (opt('personas', Object.keys(personas).join(','))).split(',');
  const spec = String(opt('runs', '')).split(',').filter(Boolean);
  const dflt = spec.find(x => !x.includes('=')), per = Object.fromEntries(spec.filter(x => x.includes('=')).map(x => x.split('=')));
  for (const k of Object.keys(per)) if (!personas[k] || !(Number(per[k]) >= 1)) throw new Error('--runs: "' + k + '=' + per[k] + '" must name a persona (' + Object.keys(personas).join(', ') + ') and a number');
  if (dflt !== undefined && !(Number(dflt) >= 1)) throw new Error('--runs: "' + dflt + '" is not a number');
  const runsOf = name => per[name] ? Number(per[name]) : dflt !== undefined ? Number(dflt) : personas[name].runs || 2;
  const runs = Math.max(...names.map(runsOf));
  for (const n of names) if (!personas[n]) throw new Error('no persona ' + n + '; they are ' + Object.keys(personas).join(', '));
  console.log('planned: ' + names.length + ' personas, ' + names.map(x => x + ' x' + runsOf(x)).join(', ') + ' = ' + names.reduce((a, x) => a + runsOf(x), 0) + ' conversations, Claude Code, model sonnet, one session each continued with --resume, at most ' + RUN_MS / 60000 + ' minutes each');
  const results = [], t0 = Date.now();
  for (let n = 1; n <= runs; n++) for (const name of names.filter(x => n <= runsOf(x))) {
    process.stdout.write('run ' + name + ' #' + n + ' ... ');
    let run;
    try { run = await runOne(name, n); } catch (e) { run = { persona: name, n, error: String(e && e.message || e), checks: [] }; }
    results.push(run);
    console.log(run.error ? 'ERROR ' + run.error : run.seconds + ' s, ' + run.claudeTurns + ' model turns, $' + run.cost.toFixed(2) + (run.timeout ? ', TIMEOUT' : '') + ', checks ' + run.checks.filter(c => c.ok === true).length + '/' + run.checks.filter(c => c.ok !== null).length);
    for (const c of run.checks) console.log('    ' + (c.ok === true ? 'pass' : c.ok === false ? 'FAIL' : 'info') + '  ' + c.what + ' -- ' + c.why);
    for (const [f, t] of Object.entries(run.memoryAtEnd || {})) console.log('    memory/' + f + ': ' + t.replace(/\n/g, ' / '));
    for (const t of run.turns || []) console.log('    > ' + t.said + '\n      < ' + t.replied.slice(0, 160) + '  [' + t.ended + ']');
  }
  console.log('\nTOTAL ' + results.length + ' runs, ' + Math.round((Date.now() - t0) / 1000) + ' s wall, $' + results.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2));
  console.log('INIT ' + JSON.stringify((results.find(r => r.init) || {}).init));
}

(async () => {
  try {
    if (flag('dry')) process.exitCode = await dry();
    else await real();
  } catch (e) { console.error(e); process.exitCode = 1; }
})();
