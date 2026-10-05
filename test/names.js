'use strict';
// This repository is public and its files are copied to strangers' machines (the npm package, the Claude Desktop
// bundle, the plugins, the skills). So nothing in it may name a person's account, mail address or private folder,
// and the product's old name (it was PhotoPrep until 2026-10-04) appears only where it still is the name of a real
// thing. Every file is read, whether it ships or not. Git history is not: PUBLISHING.md says what to do about it.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SELF = path.join('test', 'names.js');
const SKIP_DIRS = ['.git', 'node_modules', 'dist'];
const BINARY = /\.(png|jpg|jpeg|gif|ico|icns|mcpb|zip|tgz)$/i;
let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return SKIP_DIRS.includes(e.name) ? [] : files(path.join(dir, e.name));
    return BINARY.test(e.name) ? [] : [path.join(dir, e.name)];
  });
}

// The author is named ("Tal Afek") and links to the organisation; no account name, and no way to write to a person.
// The one mail address allowed is the organisation's no-reply one the commits are made with.
// The names to look for are kept out of the repository too: one per line in .private-names (ignored by git) beside
// this repo's package.json, on the machines of those who maintain it. Without that file the other rules still run.
const PRIVATE = (() => { try { return fs.readFileSync(path.join(root, '.private-names'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean); } catch (_) { return []; } })();
const escape = s => s.split('').map(c => (/[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c)).join('');
const RULES = [
  ...PRIVATE.map(n => ['a private name', new RegExp(escape(n), 'i')]),
  ['a mail address', /[A-Za-z0-9._%+-]+@(?!getpicprep\.com\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}/],
  ['a personal folder', /\/Users\/[A-Za-z]|\/home\/[a-z]|[A-Za-z]:\\+Users\\+[A-Za-z]/],
  ['a GitHub account other than the organisation', /github\.com\/(?!picprep(?:\/|\b)|anthropics\/|modelcontextprotocol\/)[A-Za-z0-9-]+/],
];

// Where the old name is still the name of a real thing:
//   - the header the app reads its session token from (x-photoprep-token);
//   - the older environment names the app and the connector still honour (PHOTOPREP_HOME, ...);
//   - a line that says it is about the older name (the state folder of a copy from before the rename).
const OLD = /photoprep/i;
const STILL_REAL = [/x-photoprep-token/gi, /\bPHOTOPREP_[A-Z_]+\b/g];
const SAYS_SO = /\b(older|old|rename|renamed|legacy|before)\b/i;

const all = files(root);
const found = [];
for (const file of all) {
  const rel = path.relative(root, file);
  if (rel === SELF || rel === '.private-names') continue;   // the rules themselves, and the names they look for
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [what, re] of RULES) if (re.test(line)) found.push(rel + ':' + (i + 1) + ': ' + what + ': ' + line.trim().slice(0, 140));
    const rest = STILL_REAL.reduce((s, re) => s.replace(re, ''), line);
    if (OLD.test(rest) && !SAYS_SO.test(line)) found.push(rel + ':' + (i + 1) + ': the old product name, on a line that does not say it is the older one: ' + line.trim().slice(0, 140));
  });
}
if (!PRIVATE.length) console.log('  --   no .private-names here: checked for mail addresses, personal folders and other accounts only');
if (found.length) for (const f of found) bad(f);
else ok(all.length + ' files: no account name, mail address, personal folder or stray old product name');

// The same for what a manifest says about its author: a name and the organisation's address, nothing else.
for (const [file, at] of [['mcpb/manifest.json', m => m.author], ['.claude-plugin/plugin.json', m => m.author], ['.claude-plugin/marketplace.json', m => m.owner], ['.codex-plugin/plugin.json', m => m.author]]) {
  const who = at(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))) || {};
  const fine = who.name === 'Tal Afek' && who.url === 'https://github.com/picprep' && Object.keys(who).every(k => ['name', 'url'].includes(k));
  if (fine) ok(file + ': the author is a name and https://github.com/picprep'); else bad(file + ': the author must be {name, url: https://github.com/picprep}, got ' + JSON.stringify(who));
}

console.log(failed ? '\n' + failed + ' name check(s) failed' : '\nnothing here names a person\'s account or a private place');
process.exit(failed ? 1 : 0);
