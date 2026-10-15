'use strict';
// One run's starting state for the personal-assistant evaluation (specs/010 FR-110): a throwaway PicPrep user folder
// holding five projects of three photos each (Post A to Post E, the app's bundled sample photos copied into
// <root>/photos), and an assistant folder made through the app's own route (POST /api/assistants, with the window key)
// from the template the app ships. Made once, with the app's server and no window; the app is started on it afterwards.
//
//   build(src, root) -> { home, place, assistant, projects: { 'Post A': { id, folder } ... } }
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SETS = {
  'Post A': ['alpine-slope', 'bay-panorama', 'beech-and-ferns'],
  'Post B': ['chateau-frontenac', 'crete-coast', 'fishing-boats'],
  'Post C': ['mongolian-lake', 'mount-ida', 'village-street'],
  'Post D': ['beech-and-ferns', 'alpine-slope', 'crete-coast'],
  'Post E': ['fishing-boats', 'village-street', 'bay-panorama'],
};

const HELPER = `
const path = require('path'), fs = require('fs');
const [src, home, place, spec] = process.argv.slice(1);
process.env.PICPREP_HOME = home; process.env.PICPREP_LICENSE_URL = 'http://127.0.0.1:9';
require(path.join(src, 'test', 'lib', 'fake-license')).seedLicense(home);
const { createServer } = require(path.join(src, 'src', 'server'));
const M = require(path.join(src, 'src', 'mcp.js'));
(async () => {
  const app = createServer({ idleMs: 0, licenseWeekly: false, writeState: false, documentsDir: place }), L = await app.listen(0);
  const base = 'http://127.0.0.1:' + L.port;
  const win = { cookie: 'pp_token=' + L.token + '; pp_win=' + L.windowKey, 'content-type': 'application/json' };
  const r = await fetch(base + '/api/assistants', { method: 'POST', headers: win, body: JSON.stringify({ name: 'studio' }) });
  const made = await r.json();
  if (r.status !== 201) throw new Error('POST /api/assistants answered ' + r.status + ': ' + JSON.stringify(made));
  const handle = M.createHandler({ http: M.httpVia(async () => ({ port: L.port, token: L.token })), log: () => {} });
  let n = 0;
  const tool = async (name, args) => {
    const x = await handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } });
    const t = x.result.content[0].text;
    if (x.result.isError) throw new Error(name + ' ' + JSON.stringify(args) + ': ' + t);
    return JSON.parse(t);
  };
  const projects = {};
  for (const p of JSON.parse(spec)) {
    const o = await tool('open_project', { folder: p.folder, name: p.name });
    const v = await tool('view', { what: 'project', project: o.id });
    await tool('propose', { project: o.id, why: 'setup', changes: [{ op: 'post.assign', args: { post: 'post1', photos: v.photos.map(x => x.id) } }, { op: 'post.destination', args: { post: 'post1', destination: 'instagram' } }] });
    projects[p.name] = { id: o.id, folder: p.folder };
  }
  await new Promise(res => app.server.close(res));
  // What the person set up is theirs: no record that an assistant made it.
  for (const m of Object.values(projects)) {
    const f = path.join(home, 'projects', m.id, 'project.json'), d = JSON.parse(fs.readFileSync(f, 'utf8'));
    d.changes = []; d.suggest = {};
    fs.writeFileSync(f, JSON.stringify(d, null, 2));
  }
  process.stdout.write(JSON.stringify({ assistant: made.path, projects }));
  process.exit(0);
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\\n'); process.exit(1); });
`;

// The person moving the mark by hand: a second server on the same user folder (the app must be stopped), acting as a window
// with the write lease, replaces each slide's mark with the same one anchored in the named corner. Returns the slides changed.
const CORNERS = { tl: [0.15, 0.15], tr: [0.85, 0.15], bl: [0.15, 0.85], br: [0.85, 0.85] };
const HAND = `
const path = require('path');
const [src, home, place, id, anchor, fx, fy] = process.argv.slice(1);
process.env.PICPREP_HOME = home; process.env.PICPREP_LICENSE_URL = 'http://127.0.0.1:9';
require(path.join(src, 'test', 'lib', 'fake-license')).seedLicense(home);
const { createServer } = require(path.join(src, 'src', 'server'));
(async () => {
  const app = createServer({ idleMs: 0, licenseWeekly: false, writeState: false, documentsDir: place }), L = await app.listen(0);
  const base = 'http://127.0.0.1:' + L.port;
  const H = { cookie: 'pp_token=' + L.token + '; pp_win=' + L.windowKey, 'content-type': 'application/json', 'x-photoprep-window': 'eval-person' };   // the header keeps the older product name
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); if (!r.ok) throw new Error(m + ' ' + p + ' answered ' + r.status + ': ' + t); return JSON.parse(t); };
  await call('POST', '/api/projects/' + id + '/lease', { window: 'eval-person' });
  const d = await call('GET', '/api/projects/' + id);
  const marked = d.slides.filter(s => s.mark);
  if (!marked.length) throw new Error('project ' + id + ' has no marked slide to move');
  await call('PATCH', '/api/projects/' + id, { rev: d.rev, ops: marked.map(s => ({ op: 'replace', path: '/slides/' + s.id + '/mark', value: Object.assign({}, s.mark, { anchor, fx: Number(fx), fy: Number(fy) }) })) });
  await call('POST', '/api/projects/' + id + '/lease', { window: 'eval-person', release: true });
  await new Promise(res => app.server.close(res));
  process.stdout.write(String(marked.length));
  process.exit(0);
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\\n'); process.exit(1); });
`;
function handMark(src, fx, project, corner) {
  if (!CORNERS[corner]) throw new Error('handMark: corner must be one of ' + Object.keys(CORNERS).join(', ') + ', got ' + corner);
  const env = Object.assign({}, process.env); delete env.PHOTOPREP_HOME; delete env.PICPREP_HOME;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', HAND, src, fx.home, fx.place, fx.projects[project].id, corner, ...CORNERS[corner]], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    child.stdout.on('data', d => { so += d; }); child.stderr.on('data', d => { se += d; });
    child.on('exit', code => code ? reject(new Error('handMark ' + project + ': ' + se)) : resolve(Number(so)));
  });
}

function build(src, root) {
  const home = path.join(root, 'home'), place = path.join(root, 'docs'), photos = path.join(root, 'photos');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(place, { recursive: true });
  const sample = path.join(src, 'assets', 'sample');
  const spec = [];
  for (const [name, files] of Object.entries(SETS)) {
    const folder = path.join(photos, name.toLowerCase().replace(' ', '-'));
    fs.mkdirSync(folder, { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(sample, f + '.jpg'), path.join(folder, f + '.jpg'));
    spec.push({ folder, name });
  }
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env); delete env.PHOTOPREP_HOME; delete env.PICPREP_HOME;
    const child = spawn(process.execPath, ['-e', HELPER, src, home, place, JSON.stringify(spec)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    child.stdout.on('data', d => { so += d; }); child.stderr.on('data', d => { se += d; });
    child.on('exit', code => { if (code) return reject(new Error('setup: ' + se)); resolve(Object.assign({ home, place }, JSON.parse(so))); });
  });
}

module.exports = { build, handMark, SETS };
