#!/usr/bin/env node
'use strict';
// The eval of PicPrep's assistant tools, after skill-creator's method: prompts a person would type, run by fresh
// assistants with and without the skills, each transcript graded on its own, the numbers gathered per iteration,
// then improve and run again. See EVAL.md.
//
//   node eval/eval.js labels                      check the labels cover every tool and operation; write evals.json
//   node eval/eval.js fixtures                    build the starting states
//   node eval/eval.js run   --iteration 1 [--tasks a,b] [--arms connector,plugin] [--runs 3] [--limit 40]
//   node eval/eval.js grade --iteration 1 [--parallel 4]
//   node eval/eval.js rescore --iteration 1       the mechanical scores again from the files (no model is asked)
//   node eval/eval.js report --iteration 1 [--previous 0]
// Needs a checkout of the app beside this repo (test/lib/app-src.js) and the `claude` command. Work goes to
// EVAL_WORK (default: a picprep-eval folder in the system's temporary folder), never into this repository.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { tasks, UNREACHED, DEFAULT_MAY, REPAIRED } = require('./tasks');
const { appSrc } = require('../test/lib/app-src');

const work = process.env.EVAL_WORK || path.join(os.tmpdir(), 'picprep-eval');
const argv = process.argv.slice(2), cmd = argv[0];
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : argv[i + 1]; };
const ARMS = opt('arms', 'connector,plugin').split(',');
const iteration = opt('iteration', '1');
const picked = () => { const want = opt('tasks', ''); return want ? tasks.filter(t => want.split(',').includes(t.name)) : tasks; };
const flat = list => list.flatMap(x => (typeof x === 'string' ? [x] : x.any));
const runDir = (t, arm, n, it = iteration) => path.join(work, 'iteration-' + it, t.name, arm, 'run-' + n);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// --app <dir>: another copy of the app's source (one carrying proposed wording, say) instead of the checkout beside this repo.
const src = () => { const s = opt('app', null) || appSrc(); if (!s) { console.error('no checkout of the app beside this repo (set PICPREP_SRC)'); process.exit(1); } return s; };

async function pool(jobs, size) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < jobs.length) { const j = jobs[i++]; await j(); } }));
}

// --- labels ---------------------------------------------------------------------------------------------------------
function labels() {
  const M = require(path.join(src(), 'src', 'mcp.js'));
  const toolNames = M.TOOLS.map(t => t.name), ops = M.TOOLS.find(t => t.name === 'propose').inputSchema.properties.changes.items.properties.op.enum;
  const all = [...toolNames, ...ops, 'order', 'set'];
  const problems = [];
  const names = new Set();
  for (const t of tasks) {
    if (names.has(t.name)) problems.push('two tasks are named ' + t.name); names.add(t.name);
    for (const i of [...flat(t.must), ...t.may, ...t.not]) if (!all.includes(i)) problems.push(t.name + ': ' + i + ' is not a tool or operation of the app');
    for (const i of flat(t.must)) if (t.not.includes(i)) problems.push(t.name + ': ' + i + ' is both required and forbidden');
  }
  const mustOf = i => tasks.filter(t => flat(t.must).includes(i)).map(t => t.name), notOf = i => tasks.filter(t => t.not.includes(i)).map(t => t.name);
  for (const i of all) {
    if (!mustOf(i).length && !UNREACHED[i]) problems.push(i + ': no task needs it');
    if (!notOf(i).length && !UNREACHED[i] && !DEFAULT_MAY.includes(i) && i !== 'propose') problems.push(i + ': no task has it as its near miss');
  }
  for (const i of Object.keys(UNREACHED)) if (!all.includes(i)) problems.push('UNREACHED names ' + i + ', which the app does not have');
  fs.writeFileSync(path.join(__dirname, 'evals.json'), JSON.stringify({
    skill_name: 'picprep (the connector, and the plugin\'s skills)',
    note: 'Written by node eval/eval.js labels from eval/tasks.js. must / may / must_not were fixed before any run.',
    always_allowed: DEFAULT_MAY, unreached: UNREACHED,
    evals: tasks.map((t, i) => ({ id: i + 1, name: t.name, prompt: t.prompts.length === 1 ? t.prompts[0] : t.prompts, starting_state: t.fixture + (t.app === 'off' ? ', PicPrep not running' : t.app === 'home' ? ', no project open' : '') + (t.licence === 'none' ? ', no licence (viewing only)' : ''),
      expected_output: t.says || 'The request is carried out with the operation made for it, on the slide or photos named, with a reason, in as few changes as it takes; the person is told it is theirs to keep or reject.',
      must: t.must, may: t.may, must_not: t.not, limits: t.limits || {}, expectations: t.expect.map(e => e.check || [].concat(e.op).join(' | ') + (e.slide ? ' on slide ' + e.slide : '') + (e.offered ? ' (offered to the person)' : ' applied')) })),
    coverage: Object.fromEntries(all.map(i => [i, { needed_by: mustOf(i), near_miss_in: notOf(i) }])),
  }, null, 1) + '\n');
  console.log(tasks.length + ' tasks; ' + toolNames.length + ' tools, ' + ops.length + ' operations, and order and set');
  for (const p of problems) console.log('  PROBLEM ' + p);
  process.exit(problems.length ? 1 : 0);
}

// --- run --------------------------------------------------------------------------------------------------------------
async function run() {
  const R = require('./lib/run'), s = src(), runs = Number(opt('runs', 3)), parallel = Math.min(2, Number(opt('parallel', 2)));   // at most two apps at once: others' timing-sensitive tests share the machine
  const todo = [];
  for (const t of picked()) for (const arm of ARMS) for (let n = 1; n <= runs; n++) if (!fs.existsSync(path.join(runDir(t, arm, n), 'timing.json'))) todo.push({ t, arm, n });
  const limit = Number(opt('limit', 0));
  if (limit) todo.splice(limit);
  console.log(todo.length + ' runs to do');
  const withApp = todo.filter(j => j.t.app !== 'off'), without = todo.filter(j => j.t.app === 'off');
  const one = async (j, locked) => {
    try { await R.runOne({ src: s, work, task: j.t, arm: j.arm, n: j.n, iteration, model: opt('model', 'sonnet'), locked }); console.log(new Date().toISOString().slice(11, 19) + ' done ' + j.t.name + ' ' + j.arm + ' ' + j.n); }
    catch (e) { console.log('FAILED ' + j.t.name + ' ' + j.arm + ' ' + j.n + ': ' + String(e.message).slice(0, 300)); }
  };
  await pool(without.map(j => () => one(j, true)), parallel);
  // One hold of the window lock per batch of two runs (about five minutes at the most, lib/run.js), then the lock is
  // given up and left alone long enough for anyone waiting to take it.
  for (let i = 0; i < withApp.length; i += parallel) {
    await R.calm(); await R.lock();
    try { await Promise.all(withApp.slice(i, i + parallel).map(j => one(j, true))); } finally { R.unlock(); }
  }
}

// --- grade ------------------------------------------------------------------------------------------------------------
function ask(prompt) {
  return new Promise(resolve => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'picprep-grader-'));
    const none = path.join(cwd, 'mcp.json'); fs.writeFileSync(none, '{"mcpServers":{}}');
    const child = spawn('claude', ['-p', '--model', opt('model', 'sonnet'), '--setting-sources', '', '--strict-mcp-config', '--mcp-config', none, '--tools', '', '--output-format', 'json', '--no-session-persistence'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', d => { out += d; });
    child.on('exit', () => { fs.rmSync(cwd, { recursive: true, force: true }); try { const r = JSON.parse(out); resolve({ text: r.result, cost: r.total_cost_usd || 0 }); } catch (_) { resolve({ text: '', cost: 0 }); } });
    child.stdin.end(prompt);
  });
}
const shortState = d => d.map(p => ({ name: p.name, posts: p.posts.map(x => ({ id: x.id, name: x.name, destination: x.destination, slides: x.slides.map(s => Object.assign({ n: s.n, id: s.id, kind: s.kind, photos: s.photos }, s.mark ? { mark: s.mark } : {})) })), groups: p.groups, changes: p.changes, questions: p.questions, offers: p.offers }));

async function grade() {
  const { score } = require('./lib/score');
  const rubric = fs.readFileSync(path.join(__dirname, 'grader.md'), 'utf8');
  const jobs = [];
  for (const t of picked().filter(x => iteration !== '1' || !REPAIRED.includes(x.name))) for (const arm of ARMS) for (let n = 1; fs.existsSync(path.join(runDir(t, arm, n), 'timing.json')); n++) {
    const dir = runDir(t, arm, n);
    const loaded = { calls: readJson(path.join(dir, 'outputs', 'calls.json')), before: readJson(path.join(dir, 'outputs', 'before.json')), after: readJson(path.join(dir, 'outputs', 'after.json')), timing: readJson(path.join(dir, 'timing.json')) };
    const sc = score(t, loaded);
    fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(sc, null, 1));
    if (fs.existsSync(path.join(dir, 'grading.json'))) continue;
    jobs.push(async () => {
      const good = t.says || 'The request is carried out with the operation made for it (' + flat(t.must).filter(x => x.includes('.') || x === 'order' || x === 'set').join(', ') + '), on the slide or photos named, in as few changes as it takes.';
      const prompt = [rubric, '', '## What the person said', ...t.prompts.map(p => '- ' + p), '', '## A good outcome', good, '',
        '## What a script established', JSON.stringify({ expectations_on_the_project: sc.expect, refused_calls: sc.errors, cut_off_before_it_answered: sc.cut }, null, 1), '',
        '## The project before', JSON.stringify(shortState(loaded.before)), '', '## The project afterwards', JSON.stringify(shortState(loaded.after)), '',
        '## The transcript', fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8')].join('\n');
      let g = null, cost = 0;
      for (let tries = 0; tries < 2 && !g; tries++) {
        const r = await ask(prompt); cost += r.cost;
        const m = /\{[\s\S]*\}/.exec(r.text || '');
        try { const j = JSON.parse(m[0]); if (Array.isArray(j.expectations) && j.expectations.length === 7) g = j; } catch (_) { /* again */ }
      }
      if (!g) return console.log('NOT GRADED ' + dir);
      const counted = g.expectations.filter(e => e.passed !== null);
      g.summary = { passed: counted.filter(e => e.passed).length, failed: counted.filter(e => !e.passed).length, total: counted.length, pass_rate: counted.length ? counted.filter(e => e.passed).length / counted.length : 1 };
      g.grader_cost = cost;
      fs.writeFileSync(path.join(dir, 'grading.json'), JSON.stringify(g, null, 1));
      console.log('graded ' + t.name + ' ' + arm + ' ' + n + ': ' + g.summary.passed + '/' + g.summary.total);
    });
  }
  console.log(jobs.length + ' transcripts to grade');
  await pool(jobs, Number(opt('parallel', 4)));
}

// --- rescore: the mechanical scores again, from the files on disk (no assistant or grader is started) ---------------
function rescore() {
  const { score } = require('./lib/score');
  let n = 0;
  for (const t of picked()) for (const arm of ARMS) for (let k = 1; fs.existsSync(path.join(runDir(t, arm, k), 'timing.json')); k++) {
    const dir = runDir(t, arm, k);
    const loaded = { calls: readJson(path.join(dir, 'outputs', 'calls.json')), before: readJson(path.join(dir, 'outputs', 'before.json')), after: readJson(path.join(dir, 'outputs', 'after.json')), timing: readJson(path.join(dir, 'timing.json')) };
    fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(score(t, loaded), null, 1)); n++;
  }
  console.log('rescored ' + n + ' runs');
}

// --- report -----------------------------------------------------------------------------------------------------------
function gather(it) {
  const rows = [];
  for (const t of tasks.filter(x => it !== '1' || !REPAIRED.includes(x.name))) for (const arm of ARMS) for (let n = 1; fs.existsSync(path.join(runDir(t, arm, n, it), 'score.json')); n++) {
    const dir = runDir(t, arm, n, it), g = fs.existsSync(path.join(dir, 'grading.json')) ? readJson(path.join(dir, 'grading.json')) : null;
    rows.push({ task: t, arm, n, dir, score: readJson(path.join(dir, 'score.json')), grading: g });
  }
  return rows;
}
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = x => (Number.isNaN(x) ? '-' : Math.round(x * 100) + '%');

function summarise(rows) {
  const out = {};
  for (const arm of ARMS) {
    const r = rows.filter(x => x.arm === arm);
    if (!r.length) continue;
    const g = (i) => { const v = r.map(x => x.grading && x.grading.expectations[i].passed).filter(p => p === true || p === false); return v.length ? mean(v.map(Number)) : NaN; };
    const ord = k => { const v = r.map(x => x.score.order[k]).filter(p => p === true || p === false); return v.length ? mean(v.map(Number)) : NaN; };
    out[arm] = {
      runs: r.length, goal: mean(r.map(x => Number(x.score.goal))), recall: mean(r.map(x => x.score.recall)), precision: mean(r.map(x => x.score.precision)),
      clean: mean(r.map(x => Number(!x.score.missed.length && !x.score.forbidden.length && !x.score.unnecessary.length && !x.score.over.length))),
      clean_one_look: mean(r.map(x => Number(!x.score.missed.length && !x.score.forbidden.length && !(x.score.unnecessary1 || x.score.unnecessary).length && !x.score.over.length))),
      forbidden: mean(r.map(x => Number(x.score.forbidden.length > 0))), unnecessary: mean(r.map(x => Number(x.score.unnecessary.length > 0))), over: mean(r.map(x => Number(x.score.over.length > 0))),
      looked: ord('looked'), status: ord('status'), cut: mean(r.map(x => Number(x.score.cut))), refused_calls: mean(r.map(x => x.score.errors)), calls: mean(r.map(x => x.score.calls)),
      seconds: mean(r.map(x => x.score.seconds)), cost: r.reduce((a, x) => a + (x.score.cost || 0), 0),
      outcome: g(0), truthful: g(1), reasons: g(2), handover: g(3), recovery: g(4), person_only: g(5), economy: g(6),
    };
  }
  return out;
}

// Per tool and operation: how often it was the right one, how often it was used then, and what was used in its place.
function perItem(rows, arm) {
  const table = {};
  const row = i => (table[i] = table[i] || { should: 0, used: 0, missed: 0, wrong: 0, extra: 0, instead: {}, refused: 0 });
  for (const x of rows.filter(r => r.arm === arm)) {
    const t = x.task, s = x.score, allowed = new Set([...flat(t.must), ...t.may, ...DEFAULT_MAY]);
    for (const m of t.must) {
      const alts = typeof m === 'string' ? [m] : m.any, hit = alts.filter(a => s.used.includes(a));
      for (const a of alts) { const r = row(a); r.should += 1 / alts.length; if (hit.includes(a)) r.used += 1 / (hit.length || 1); }
      if (!hit.length) for (const a of alts) { const r = row(a); r.missed += 1 / alts.length; for (const u of s.used.filter(u => !allowed.has(u))) r.instead[u] = (r.instead[u] || 0) + 1; }
    }
    for (const u of s.used) { if (t.not.includes(u)) row(u).wrong++; else if (!allowed.has(u)) row(u).extra++; }
  }
  return table;
}

function report() {
  const rows = gather(iteration), prev = opt('previous', null), before = prev === null ? null : gather(prev);
  const lines = [];
  const sum = summarise(rows), was = before ? summarise(before.filter(b => rows.some(r => r.task.name === b.task.name))) : null;
  const keys = ['runs', 'goal', 'outcome', 'recall', 'precision', 'clean', 'clean_one_look', 'forbidden', 'unnecessary', 'over', 'looked', 'status', 'truthful', 'reasons', 'handover', 'recovery', 'person_only', 'economy', 'cut', 'refused_calls', 'calls', 'seconds', 'cost'];
  const show = (k, v) => (v === undefined ? '-' : ['runs'].includes(k) ? v : ['refused_calls', 'calls'].includes(k) ? v.toFixed(1) : k === 'seconds' ? Math.round(v) : k === 'cost' ? '$' + v.toFixed(2) : pct(v));
  lines.push('| measure | ' + ARMS.map(a => (was ? a + ' before | ' + a + ' after' : a)).join(' | ') + ' |', '|---|' + ARMS.map(() => (was ? '---|---' : '---')).join('|') + '|');
  for (const k of keys) lines.push('| ' + k + ' | ' + ARMS.map(a => (was ? show(k, (was[a] || {})[k]) + ' | ' : '') + show(k, (sum[a] || {})[k])).join(' | ') + ' |');
  lines.push('', '### Per task (goal reached in the app / tools chosen cleanly, of the runs)', '', '| task | ' + ARMS.join(' | ') + ' | typical miss |', '|---|' + ARMS.map(() => '---').join('|') + '|---|');
  for (const t of tasks) {
    const cells = ARMS.map(a => { const r = rows.filter(x => x.task.name === t.name && x.arm === a); return r.length ? r.filter(x => x.score.goal).length + '/' + r.length + ' · ' + r.filter(x => !x.score.missed.length && !x.score.forbidden.length && !x.score.unnecessary.length && !x.score.over.length).length + '/' + r.length : '-'; });
    const r = rows.filter(x => x.task.name === t.name); if (!r.length) continue;
    const miss = {}; for (const x of r) for (const m of [...x.score.missed.map(m => 'missed ' + m), ...x.score.forbidden.map(m => 'forbidden ' + m), ...x.score.unnecessary.map(m => 'extra ' + m), ...x.score.over.map(m => 'over: ' + m), ...(x.score.cut ? ['cut off'] : [])]) miss[m] = (miss[m] || 0) + 1;
    lines.push('| ' + t.name + ' | ' + cells.join(' | ') + ' | ' + Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' x' + v).join('; ') + ' |');
  }
  for (const arm of ARMS) {
    const tb = perItem(rows, arm), tb0 = before ? perItem(before, arm) : null;
    lines.push('', '### Per tool and operation: ' + arm, '', '| tool or operation | should | used when it should' + (tb0 ? ' (before)' : '') + ' | used wrongly | used needlessly | picked instead when missed |', '|---|---|---|---|---|---|');
    for (const [i, r] of Object.entries(tb).sort((a, b) => (a[0].includes('.') ? 1 : 0) - (b[0].includes('.') ? 1 : 0) || a[0].localeCompare(b[0]))) {
      const r0 = tb0 && tb0[i];
      lines.push('| ' + i + ' | ' + (+r.should.toFixed(1)) + ' | ' + (+r.used.toFixed(1)) + (r0 ? ' (' + (+r0.used.toFixed(1)) + ' of ' + (+r0.should.toFixed(1)) + ')' : '') + ' | ' + r.wrong + ' | ' + r.extra + ' | ' + Object.entries(r.instead).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' x' + v).join(', ') + ' |');
    }
  }
  const out = path.join(work, 'iteration-' + iteration, 'benchmark.md');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  fs.writeFileSync(path.join(work, 'iteration-' + iteration, 'benchmark.json'), JSON.stringify({ iteration, summary: sum, previous: was, runs: rows.map(x => ({ task: x.task.name, arm: x.arm, n: x.n, score: x.score, grading: x.grading && { expectations: x.grading.expectations.map(e => e.passed), worst: x.grading.worst, confusion: x.grading.confusion } })) }, null, 1));
  console.log(lines.slice(0, keys.length + 2).join('\n'));
  console.log('\nwritten: ' + out);
}

if (cmd === 'labels') labels();
else if (cmd === 'fixtures') require('./lib/fixtures').build(src(), work, opt('only', '') ? opt('only', '').split(',') : null).then(o => console.log('built ' + Object.keys(o).join(', ') + ' in ' + work), e => { console.error(String(e.message || e)); process.exit(1); });
else if (cmd === 'run') run();
else if (cmd === 'grade') grade();
else if (cmd === 'report') report();
else if (cmd === 'rescore') rescore();
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 2 : 0); }
