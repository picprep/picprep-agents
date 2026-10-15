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

module.exports = { build, SETS };
