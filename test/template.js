'use strict';
// The assistant template is copied into a person's workspace and read by many AI apps, each in its own way.
// A memory file named twice is read twice; one named nowhere is never read; a stray root instruction file
// can replace AGENTS.md in some apps. So: every always-loaded memory file is named once in each place, the
// two redirect files are exactly @AGENTS.md, and nothing else sits at the root that an app would prefer.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tpl = path.join(root, 'template');
let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };
const check = (cond, m, detail) => cond ? ok(m) : bad(m + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
const read = f => fs.readFileSync(path.join(tpl, f), 'utf8');
const count = (list, x) => list.filter(y => y === x).length;

const ALWAYS = ['about', 'preferences', 'how-you-work', 'recent'].map(n => 'memory/' + n + '.md');
const WHEN_NEEDED = ['captions', 'references', 'archive'].map(n => 'memory/' + n + '.md');
const SKILLS = ['onboard', 'learn', 'caption', 'feed', 'deliver'].map(n => 'picprep-' + n);

for (const f of [...ALWAYS, ...WHEN_NEEDED, 'memory/sources/.gitkeep', 'CHANGES.md', 'VERSION']) check(fs.existsSync(path.join(tpl, f)), f + ' exists');
check(read('VERSION') === '1\n', 'VERSION is 1');
for (const f of [...ALWAYS, ...WHEN_NEEDED]) check(/^<!--[^]*?-->/.test(read(f)), f + ' starts with a comment saying what goes in it');

const imports = read('AGENTS.md').split('\n').filter(l => /^@\S+$/.test(l)).map(l => l.slice(1));
const oc = (() => { try { return JSON.parse(read('opencode.json')).instructions; } catch (e) { bad('opencode.json: ' + e.message); return []; } })();
const rule = read('.agents/rules/memory.md');
check(/^---\ntrigger: always_on\n---\n/.test(rule), '.agents/rules/memory.md has trigger: always_on');
const includes = [...rule.matchAll(/^@\[[^\]]+\]\(\.\.\/\.\.\/([^)]+)\)$/gm)].map(m => m[1]);
for (const f of ALWAYS) {
  check(count(imports, f) === 1, 'AGENTS.md imports ' + f + ' once', count(imports, f));
  check(count(oc, f) === 1, 'opencode.json lists ' + f + ' once', count(oc, f));
  check(count(includes, f) === 1, '.agents/rules/memory.md includes ' + f + ' once', count(includes, f));
}
check(imports.length === ALWAYS.length && oc.length === ALWAYS.length && includes.length === ALWAYS.length, 'nothing else is always loaded', [imports, oc, includes]);
for (const f of WHEN_NEEDED) check(!imports.includes(f) && !oc.includes(f) && !includes.includes(f), f + ' is not always loaded');

check(read('CLAUDE.md') === '@AGENTS.md\n', 'CLAUDE.md is exactly @AGENTS.md');
check(read('GEMINI.md') === '@AGENTS.md\n', 'GEMINI.md is exactly @AGENTS.md');
for (const f of ['.cursorrules', '.windsurfrules', '.clinerules', '.rules', 'AGENT.md', '.github/copilot-instructions.md']) check(!fs.existsSync(path.join(tpl, f)), 'no ' + f + ' at the template root');

for (const dir of ['.agents/skills', '.claude/skills']) {
  check(same(fs.readdirSync(path.join(tpl, dir)).sort(), [...SKILLS].sort()), dir + ' holds the five skills', fs.readdirSync(path.join(tpl, dir)));
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
for (const s of SKILLS) {
  const a = read('.agents/skills/' + s + '/SKILL.md'), b = read('.claude/skills/' + s + '/SKILL.md');
  check(a === b, s + ' is identical in both skill folders');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(a);
  const fields = {};
  if (m) for (const line of m[1].split('\n')) { const kv = /^([a-z]+):\s*(.*)$/.exec(line); if (kv) fields[kv[1]] = kv[2]; }
  check(m && !a.includes('\r') && fields.name === s && fields.description && fields.description.length > 40, s + ' has valid front matter (name, one-line description)', fields);
}

for (const f of ['.claude/settings.json', '.codex/hooks.json']) {
  try {
    const h = JSON.parse(read(f)).hooks.SessionStart;
    check(h.length === 1 && h[0].matcher === 'startup|compact' && h[0].hooks[0].type === 'command', f + ' has a SessionStart hook for startup and compact', h);
  } catch (e) { bad(f + ': ' + e.message); }
}

// Everything under template/ is walked by the private-names check (it reads every file in the repo).
const names = spawnSync(process.execPath, [path.join(__dirname, 'names.js')], { encoding: 'utf8' });
check(names.status === 0, 'test/names.js passes with the template in place', names.stdout.split('\n').filter(l => /FAIL/.test(l)));

console.log(failed ? '\n' + failed + ' template check(s) failed' : '\nthe template loads each memory file once, in every assistant');
process.exit(failed ? 1 : 0);
