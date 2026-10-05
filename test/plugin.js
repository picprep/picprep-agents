'use strict';
// Plugins, extensions and bundles are files a *different* program reads, so nothing here fails the
// way a broken require would: a malformed manifest or skill is simply never loaded, and the first sign
// of trouble is an assistant that quietly doesn't know PicPrep exists. Hence this test, for every
// manifest the repo ships, every skill, and every copy-paste snippet in docs/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };
const check = (cond, m, detail) => cond ? ok(m) : bad(m + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rel = (...p) => path.join(root, ...p);

function json(file) {
  try { const v = JSON.parse(fs.readFileSync(rel(file), 'utf8')); ok(file + ' parses'); return v; }
  catch (e) { bad(file + ': ' + e.message); return null; }
}

// --- the package ------------------------------------------------------------------------------------------
const pkg = json('packages/picprep-mcp/package.json') || {};
const VERSION = pkg.version;
const SERVER = { command: 'npx', args: ['-y', pkg.name] };
check(pkg.name === 'picprep-mcp' && pkg.license === 'MIT', 'the package is picprep-mcp, MIT', [pkg.name, pkg.license]);
check(!pkg.dependencies && !pkg.devDependencies && !pkg.peerDependencies && !pkg.optionalDependencies, 'the package has no dependencies');
const binFile = pkg.bin && pkg.bin['picprep-mcp'] && rel('packages/picprep-mcp', pkg.bin['picprep-mcp']);
check(binFile && fs.existsSync(binFile) && fs.readFileSync(binFile, 'utf8').startsWith('#!/usr/bin/env node\n'), 'its picprep-mcp command exists and starts with a node shebang', pkg.bin);
for (const f of pkg.files || []) check(fs.existsSync(rel('packages/picprep-mcp', f)), 'the package ships ' + f);
// What `npm publish` needs to be right the first time: a version of a public package cannot be taken back.
check(pkg.private === undefined, 'the package is not marked private (it is the one thing here that is published)', pkg.private);
check(same(pkg.files, ['bridge.js', 'bin', 'README.md', 'LICENSE']) && same(fs.readdirSync(rel('packages/picprep-mcp', 'bin')), ['picprep-mcp.js']), 'it ships bridge.js, bin/picprep-mcp.js, README.md and LICENSE (with package.json: five files)', pkg.files);
check(pkg.repository && pkg.repository.url === 'git+https://github.com/picprep/picprep-agents.git' && pkg.repository.directory === 'packages/picprep-mcp', 'its repository is picprep/picprep-agents, this folder (npm provenance checks it)', pkg.repository);
// The MCP Registry (registry.modelcontextprotocol.io) lists a server from server.json and checks the npm package
// names the same server (mcpName): both must be in the version that is published.
{
  const reg = json('packages/picprep-mcp/server.json') || {};
  const p0 = (reg.packages || [])[0] || {};
  check(pkg.mcpName === 'io.github.picprep/picprep-mcp' && reg.name === pkg.mcpName, 'package.json mcpName and server.json name are io.github.picprep/picprep-mcp', [pkg.mcpName, reg.name]);
  check(reg.version === VERSION && p0.registryType === 'npm' && p0.identifier === pkg.name && p0.version === VERSION && p0.transport && p0.transport.type === 'stdio', 'server.json lists the npm package at version ' + VERSION + ', over stdio', reg);
  check((reg.description || '').length > 0 && reg.description.length <= 100, 'its description is at most 100 characters', (reg.description || '').length);
}
check(pkg.engines && pkg.engines.node === '>=18' && pkg.main === 'bridge.js', 'it runs on Node 18 or newer', pkg.engines);
check(fs.readFileSync(rel('packages/picprep-mcp/LICENSE'), 'utf8') === fs.readFileSync(rel('LICENSE'), 'utf8'), 'its LICENSE is the repository\'s');
check(json('package.json').private === true, 'the repository root is private: only packages/picprep-mcp is published');
{
  // "none of the app's code" and no dependencies (FR-090): the bridge needs only Node's own modules.
  const builtins = new Set(require('module').builtinModules);
  for (const f of ['bridge.js', pkg.bin && pkg.bin['picprep-mcp']].filter(Boolean)) {
    const src = fs.readFileSync(rel('packages/picprep-mcp', f), 'utf8');
    const reqs = [...src.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(m => m[1]);
    const outside = reqs.filter(r => !builtins.has(r.replace(/^node:/, '')) && !/^\.\.?\//.test(r));
    check(!outside.length, f + ' requires only Node\'s own modules and its own files', outside);
  }
}

// --- Claude Code: plugin and marketplace ----------------------------------------------------------------
const claude = json('.claude-plugin/plugin.json');
if (claude) {
  check(claude.name === 'picprep', 'Claude Code plugin is named picprep', claude.name);
  check(claude.version === VERSION, 'Claude Code plugin version matches picprep-mcp (' + VERSION + ')', claude.version);
  check(same(claude.mcpServers, { picprep: SERVER }), 'Claude Code plugin runs npx -y picprep-mcp', claude.mcpServers);
}
const market = json('.claude-plugin/marketplace.json');
if (market && claude) {
  check(market.name && market.owner && market.owner.name && Array.isArray(market.plugins), 'Claude Code marketplace has a name, an owner and plugins');
  const entry = (market.plugins || []).find(p => p.name === claude.name);
  check(entry, 'the marketplace lists the plugin under the plugin\'s own name (' + claude.name + ')', market.plugins);
  if (entry) check(typeof entry.source === 'string' && entry.source.startsWith('./') && !entry.source.includes('..') && fs.existsSync(path.join(root, entry.source, '.claude-plugin', 'plugin.json')), 'its source is a path inside the repo holding the plugin', entry.source);
}

// --- Codex: plugin, its MCP file and marketplace ----------------------------------------------------------
const codex = json('.codex-plugin/plugin.json');
if (codex) {
  check(codex.name === 'picprep' && codex.version === VERSION, 'Codex plugin is picprep ' + VERSION, [codex.name, codex.version]);
  check(fs.existsSync(rel(codex.skills || 'missing')), 'Codex plugin points at the skills folder', codex.skills);
  check(codex.mcpServers === './mcp.json', 'Codex plugin points at mcp.json', codex.mcpServers);
}
const mcpJson = json('mcp.json');
if (mcpJson) check(same(mcpJson.mcpServers, { picprep: SERVER }), 'mcp.json runs npx -y picprep-mcp', mcpJson);
// A .mcp.json at the root would make Claude Code register the server a second time, beside the plugin's own.
check(!fs.existsSync(rel('.mcp.json')), 'no .mcp.json at the root (Claude Code would load the server twice)');
const codexMarket = json('.agents/plugins/marketplace.json');
if (codexMarket) {
  const e = (codexMarket.plugins || []).find(p => p.name === 'picprep');
  check(e && e.source && e.source.source === 'local' && /^\.\//.test(e.source.path) && !e.source.path.includes('..') && fs.existsSync(path.join(root, e.source.path, '.codex-plugin', 'plugin.json')), 'Codex marketplace lists picprep from this repo', e);
}

// --- Gemini CLI extension ----------------------------------------------------------------------------------
const gemini = json('gemini-extension.json');
if (gemini) {
  check(gemini.name === 'picprep' && gemini.version === VERSION, 'Gemini CLI extension is picprep ' + VERSION, [gemini.name, gemini.version]);
  check(same(gemini.mcpServers, { picprep: SERVER }), 'Gemini CLI extension runs npx -y picprep-mcp', gemini.mcpServers);
}

// --- Claude Desktop bundle (.mcpb) ----------------------------------------------------------------------
const mcpb = json('mcpb/manifest.json');
let bundleDir = null;
if (mcpb) {
  check(mcpb.manifest_version === '0.3' && mcpb.name && mcpb.description && mcpb.author && mcpb.author.name, 'the .mcpb manifest has its required fields');
  check(mcpb.version === VERSION, '.mcpb manifest version matches picprep-mcp (' + VERSION + ')', mcpb.version);
  check(mcpb.server && mcpb.server.type === 'node' && mcpb.server.entry_point === 'server/index.js' && same(mcpb.server.mcp_config, { command: 'node', args: ['${__dirname}/server/index.js'] }), 'the .mcpb runs its own server/index.js with node', mcpb.server);
  check(!mcpb.icon || fs.existsSync(rel('mcpb', mcpb.icon)), 'the .mcpb icon exists', mcpb.icon);
  try {
    const { build } = require('../scripts/build-mcpb.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'picprep-mcpb-'));
    const files = unzip(fs.readFileSync(build(path.join(tmp, 'picprep.mcpb'))));
    const names = Object.keys(files);
    check(['manifest.json', 'server/index.js', 'server/bridge.js', 'server/package.json'].every(n => names.includes(n)), 'the built .mcpb holds the manifest and the bridge', names);
    check(files['server/bridge.js'] && files['server/bridge.js'].equals(fs.readFileSync(rel('packages/picprep-mcp/bridge.js'))), 'its bridge is the package\'s, byte for byte');
    for (const [n, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(tmp, 'x', n)), { recursive: true }); fs.writeFileSync(path.join(tmp, 'x', n), data); }
    bundleDir = path.join(tmp, 'x');
  } catch (e) { bad('building the .mcpb: ' + e.message); }
}

// Reads back a stored (uncompressed) zip, checking every entry's CRC.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('no end of central directory');
  const count = buf.readUInt16LE(end + 10), out = {};
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry ' + i);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (method !== 0) throw new Error(name + ' is compressed (method ' + method + ')');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (zlib.crc32(data) !== crc) throw new Error(name + ': CRC mismatch');
    out[name] = data;
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

// --- skills ---------------------------------------------------------------------------------------------
const skillsDir = rel('skills');
const skills = fs.readdirSync(skillsDir).filter(d => fs.statSync(path.join(skillsDir, d)).isDirectory());
check(skills.length, skills.length + ' skill(s) present');
for (const dir of skills) {
  const file = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(file)) { bad(dir + '/SKILL.md missing'); continue; }
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\r')) { bad(dir + ': CRLF line endings (skills must be LF, see .gitattributes)'); continue; }
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) { bad(dir + ': no front matter block'); continue; }
  // Deliberately not a YAML parser: the front matter is two flat keys.
  const fields = {};
  for (const line of m[1].split('\n')) { const kv = /^([a-z]+):\s*(.*)$/.exec(line); if (kv) fields[kv[1]] = kv[2]; }
  check(fields.name === dir, dir + ': name matches its directory', fields.name);
  // The description is the whole triggering mechanism: a thin one is installed and never used.
  check(fields.description && fields.description.length > 120, dir + ': description is substantial');
  check(text.slice(m[0].length).trim().length > 400, dir + ': has a body');
}
// Until the app repo hands its skills over for good, the copies here must not drift from it
// (a skill and the tool it drives stay in step).
{
  const app = require('./lib/app-src').appSrc(), src = app && path.join(app, 'skills');
  if (src && fs.existsSync(src)) {
    const theirs = fs.readdirSync(src).filter(d => fs.existsSync(path.join(src, d, 'SKILL.md')));
    check(same(theirs.sort(), skills.slice().sort()), 'the same skills as the app repo\'s skills/', { here: skills, app: theirs });
    for (const d of theirs.filter(x => skills.includes(x))) {
      check(fs.readFileSync(path.join(src, d, 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(skillsDir, d, 'SKILL.md'), 'utf8'), d + ' is the same as the app repo\'s (copy it over: node scripts/sync-skills.js)');
    }
  } else console.log('  --   no app checkout with skills beside this repo: the copies here are the only ones');
}

// --- docs: one page per harness, every snippet valid ----------------------------------------------------
const HARNESSES = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'antigravity', 'gemini-cli', 'vscode', 'devin-cli', 'opencode', 'oh-my-pi', 'windsurf', 'zed', 'cline', 'goose'];
const readme = fs.readFileSync(rel('README.md'), 'utf8');
for (const h of HARNESSES) {
  const f = rel('docs', h + '.md');
  if (!fs.existsSync(f)) { bad('docs/' + h + '.md missing'); continue; }
  const text = fs.readFileSync(f, 'utf8');
  check(text.includes('picprep-mcp'), 'docs/' + h + '.md runs picprep-mcp');
  check(readme.includes('docs/' + h + '.md'), 'the README links docs/' + h + '.md');
  for (const [, body] of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    try { JSON.parse(body); } catch (e) { bad('docs/' + h + '.md has a JSON snippet that does not parse: ' + e.message); continue; }
    ok('docs/' + h + '.md: a JSON snippet parses');
  }
}
// Each command the README's table gives must be the one its assistant's page gives: the site quotes both.
for (const line of readme.split('\n').filter(l => /^\| .* \| .*docs\/[a-z-]+\.md/.test(l))) {
  const page = /docs\/([a-z-]+)\.md/.exec(line)[1], cmds = [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(c => / /.test(c));
  const text = fs.existsSync(rel('docs', page + '.md')) ? fs.readFileSync(rel('docs', page + '.md'), 'utf8') : '';
  for (const c of cmds) check(text.includes(c), 'the README\'s "' + c + '" is what docs/' + page + '.md says');
}
{
  // The Cursor install link must decode to exactly the server entry everyone else runs.
  const link = /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=([^&\s)]+)&config=([A-Za-z0-9+/=]+)/.exec(fs.readFileSync(rel('docs', 'cursor.md'), 'utf8'));
  let cfg = null;
  try { cfg = link && JSON.parse(Buffer.from(link[2], 'base64').toString('utf8')); } catch (_) { /* reported below */ }
  check(link && link[1] === 'picprep' && same(cfg, SERVER), 'the Cursor install link adds picprep with npx -y picprep-mcp', cfg);
}

// --- the bundle's server answers through the bridge -------------------------------------------------------
// Run the extracted .mcpb's server/index.js exactly as Claude Desktop would, against a fake app, and ask
// for the tools: a bundle whose entry fails to start shows only as an extension with no tools.
async function bundleCheck() {
  if (!bundleDir) return;
  const { startFakeApp, toolsFor } = require('./lib/fake-app');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'picprep-plugin-home-'));
  const app = await startFakeApp({ home });
  const entry = mcpb.server.mcp_config.args.map(a => a.replace('${__dirname}', bundleDir));
  const env = Object.assign({}, process.env, { PICPREP_HOME: home, PICPREP_APP: path.join(home, 'no-app') });
  const child = spawn(process.execPath, entry, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const answer = await new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 10000);
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch (_) { return; }
      if (m.id === 2) { clearTimeout(t); resolve(m); }
    });
    const send = o => child.stdin.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, o)) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-test', version: '1' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
  });
  check(answer && answer.result && same(answer.result.tools, toolsFor()), 'the .mcpb server starts and lists the app\'s tools', answer);
  child.kill();
  await app.stop();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(path.dirname(bundleDir), { recursive: true, force: true });
}

bundleCheck().catch(e => bad('bundle check crashed: ' + (e && e.stack || e))).finally(() => {
  console.log(failed ? '\n' + failed + ' plugin check(s) failed' : '\nevery manifest, skill and snippet is well-formed');
  process.exit(failed ? 1 : 0);
});
