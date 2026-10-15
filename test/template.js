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
check(read('VERSION') === '3\n', 'VERSION is 3');
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

const STAGE = ['select', 'sort', 'compose', 'watermark', 'export'].map(n => 'picprep-' + n);
// Each skill is shipped once, in .agents/skills; PicPrep links .claude/skills to it when it makes an assistant.
check(!fs.existsSync(path.join(tpl, '.claude/skills')), 'no .claude/skills in the template (PicPrep links it to .agents/skills)');
{
  const dir = '.agents/skills';
  check(same(fs.readdirSync(path.join(tpl, dir)).sort(), [...SKILLS, ...STAGE].sort()), dir + ' holds the five assistant skills and the five stage skills, each once', fs.readdirSync(path.join(tpl, dir)));
  for (const s of STAGE) {
    const differ = diffTree(path.join(root, 'skills', s), path.join(tpl, dir, s));
    check(!differ.length, dir + '/' + s + ' matches skills/' + s + (differ.length ? ' (run: node scripts/sync-template-skills.mjs)' : ''), differ);
  }
}
function files(d, base = d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]).sort(); }
function diffTree(a, b) {
  if (!fs.existsSync(b)) return ['missing ' + b];
  const fa = files(a), fb = files(b), out = [];
  for (const f of new Set([...fa, ...fb])) {
    if (!fa.includes(f) || !fb.includes(f)) out.push(f);
    else if (!fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))) out.push(f);
  }
  return out;
}
check(read('AGENTS.md').includes('If the contents of these files are not already in your context, read them now, and again whenever they are gone.'), 'AGENTS.md reads the memory once, only if not already in context');
check(!fs.existsSync(path.join(tpl, '.claude/settings.json')), 'no .claude/settings.json (a hook that does nothing)');
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
for (const s of SKILLS) {
  const a = read('.agents/skills/' + s + '/SKILL.md');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(a);
  const fields = {};
  if (m) for (const line of m[1].split('\n')) { const kv = /^([a-z]+):\s*(.*)$/.exec(line); if (kv) fields[kv[1]] = kv[2]; }
  check(m && !a.includes('\r') && fields.name === s && fields.description && fields.description.length > 40, s + ' has valid front matter (name, one-line description)', fields);
}

for (const f of ['.codex/hooks.json']) {
  try {
    const h = JSON.parse(read(f)).hooks.SessionStart;
    check(h.length === 1 && h[0].matcher === 'startup|compact' && h[0].hooks[0].type === 'command', f + ' has a SessionStart hook for startup and compact', h);
  } catch (e) { bad(f + ': ' + e.message); }
}

// Codex does not expand @imports, so its hook prints exactly the always-loaded files; Claude Code loads them
// through CLAUDE.md, so it has no hook (a second copy would be read twice).
try {
  const cmd = JSON.parse(read('.codex/hooks.json')).hooks.SessionStart[0].hooks[0].command;
  check(cmd === 'cat ' + ALWAYS.join(' '), '.codex/hooks.json prints exactly the four always-loaded files', cmd);
} catch (e) { bad('hook commands: ' + e.message); }

// Everything under template/ is walked by the private-names check (it reads every file in the repo).
const names = spawnSync(process.execPath, [path.join(__dirname, 'names.js')], { encoding: 'utf8' });
check(names.status === 0, 'test/names.js passes with the template in place', names.stdout.split('\n').filter(l => /FAIL/.test(l)));

console.log(failed ? '\n' + failed + ' template check(s) failed' : '\nthe template loads each memory file once, in every assistant');
process.exit(failed ? 1 : 0);
