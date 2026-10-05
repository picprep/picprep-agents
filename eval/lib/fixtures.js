'use strict';
// Builds the starting states of the eval (eval/evals.json "fixture"): each is a PicPrep user folder with a project
// in a known state, made once with the app's own server (no window) and its own tools, then copied fresh for every
// run. The photos are a copy of the app's bundled sample, in <work>/photos/trip.
//
//   fresh     the folder opened as a project, nothing picked
//   carousel  a person's finished pick: seven photos in the post, for Instagram, the third slide a stack of three
//   prior     an assistant went through the photos in an earlier session: six in the post, three cut and one maybe,
//             each with its reason; not reviewed yet
//   studio    one slide of every kind, two posts and a group (see STUDIO)
//   marked    carousel, every slide carrying the sample watermark
//   asked     studio, with a question the assistant left open
//   two       carousel, plus a second project (lisbon) of four photos
// A state the person made is one whose record of assistant changes was emptied afterwards (the changes were made
// through the tools, because that is the one way this script has to make them).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HELPER = `
const path = require('path'), fs = require('fs');
const [src, home, spec] = process.argv.slice(1);
process.env.PICPREP_HOME = home; process.env.PICPREP_LICENSE_URL = 'http://127.0.0.1:9';
require(path.join(src, 'test', 'lib', 'fake-license')).seedLicense(home);
const { createServer } = require(path.join(src, 'src', 'server'));
const M = require(path.join(src, 'src', 'mcp.js'));
(async () => {
  const app = createServer({ idleMs: 0, licenseWeekly: false, writeState: false }), L = await app.listen(0);
  const handle = M.createHandler({ http: M.httpVia(async () => ({ port: L.port, token: L.token })), log: () => {} });
  let n = 0;
  const tool = async (name, args) => {
    let r = await handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } });
    // The app takes 20 changes a minute from an assistant: wait the minute out.
    if (r.result.isError && /changes a minute/.test(r.result.content[0].text)) { await new Promise(res => setTimeout(res, 61000)); r = await handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }); }
    const t = r.result.content[0].text;
    if (r.result.isError) throw new Error(name + ' ' + JSON.stringify(args) + ': ' + t);
    return JSON.parse(t);
  };
  const steps = JSON.parse(spec), made = {};
  for (const s of steps) {
    const o = await tool('open_project', { folder: s.folder, name: s.name });
    const p = await tool('view', { what: 'project', project: o.id });
    const id = Object.fromEntries(p.photos.map(x => [x.name.replace(/\\.jpg$/, ''), x.id]));
    const slides = async () => (await tool('view', { what: 'project', project: o.id })).slides;
    // "@p:<name>" is that photo's id, "@s:<k>" the id of the k-th slide in the list at that moment.
    // A slide by 'kind first-photo count'.
    const key = x => x.kind + ' ' + x.photos[0].replace(/\.jpg$/, '') + ' ' + x.photos.length;
    const one = (now, k) => { const hit = now.filter(x => key(x) === k); if (hit.length !== 1) throw new Error('slide ' + k + ' matches ' + hit.length + ' of ' + now.map(key).join(', ')); return hit[0].id; };
    const fill = async v => {
      if (typeof v === 'string' && v.startsWith('@p:')) { if (!id[v.slice(3)]) throw new Error('no photo ' + v); return id[v.slice(3)]; }
      if (typeof v === 'string' && v.startsWith('@s:')) return (await slides())[Number(v.slice(3)) - 1].id;
      if (typeof v === 'string' && v.startsWith('@k:')) return one(await slides(), v.slice(3));
      if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await fill(x)); return out; }
      if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v)) out[k] = await fill(v[k]); return out; }
      return v;
    };
    for (const [op, args, why] of s.changes || []) {
      if (op === '@order') {   // each entry: 'kind first-photo count'
        const now = await slides(), ids = args.map(k => one(now, k));
        await tool('propose', { project: o.id, why: 'setup', slides: ids }); continue;
      }
      if (op === '@fill') {   // a photo into the slide's one empty cell
        const a = await fill(args), sl = (await slides()).find(x => x.id === a.slide), cell = Object.keys(sl.cells).find(c => sl.cells[c] === null);
        await tool('propose', { project: o.id, why: 'setup', changes: [{ op: 'slide.putPhoto', args: { slide: a.slide, cell, photo: a.photo } }] }); continue;
      }
      if (op === '@marks') {   // the bundled sample mark on every slide, bottom left: Watermark has something to pick between
        const set = (await slides()).map(x => ({ target: '/slides/' + x.id + '/mark', value: { on: true, id: 'sample-dark', place: 'anchor', anchor: 'bl', insX: 5, insY: 5, fx: 0.15, fy: 0.85, sizePct: 22, op: 0.55 } }));
        await tool('propose', { project: o.id, tab: 'watermark', why: 'setup', set }); continue;
      }
      if (op === '@ask') { await tool('ask', Object.assign({ project: o.id }, args)); continue; }
      const r = await tool('propose', { project: o.id, why: why || 'setup', changes: [{ op, args: await fill(args) }] });
      if (!r.changes.length || r.changes[0].state !== 'applied') throw new Error(s.name + ': ' + op + ' was not applied: ' + JSON.stringify(r));
    }
    made[s.name] = { id: o.id, mine: !!s.mine };
  }
  await new Promise(r => app.server.close(r));
  // The person's own work: no record that an assistant made it.
  for (const m of Object.values(made)) if (m.mine) {
    const f = path.join(home, 'projects', m.id, 'project.json'), d = JSON.parse(fs.readFileSync(f, 'utf8'));
    d.changes = []; d.suggest = {};
    fs.writeFileSync(f, JSON.stringify(d, null, 2));
  }
  // The app must still read every project it is handed.
  {
    const again = createServer({ idleMs: 0, licenseWeekly: false, writeState: false }), L2 = await again.listen(0);
    const h2 = M.createHandler({ http: M.httpVia(async () => ({ port: L2.port, token: L2.token })), log: () => {} });
    for (const m of Object.values(made)) {
      const r = await h2({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'view', arguments: { what: 'project', project: m.id } } });
      if (r.result.isError) throw new Error('the app cannot read the project it was left: ' + r.result.content[0].text);
    }
  }
  process.stdout.write(JSON.stringify(made));
  process.exit(0);
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\\n'); process.exit(1); });
`;

const P = names => names.map(n => '@p:' + n);
const CAROUSEL = [
  ['post.assign', { post: 'post1', photos: P(['alpine-slope', 'bay-panorama', 'beech-and-ferns', 'young-beech', 'village-street', 'fishing-boats', 'crete-coast']) }],
  ['post.destination', { post: 'post1', destination: 'instagram' }],
  ['slide.stack', { slide: '@k:solo beech-and-ferns 1', with: '@k:solo young-beech 1' }],
  ['slide.stack', { slide: '@k:stack beech-and-ferns 2', with: '@k:solo village-street 1' }],
];
const PRIOR = [
  ['post.assign', { post: 'post1', photos: P(['alpine-slope', 'bay-panorama', 'beech-and-ferns', 'village-street', 'fishing-boats', 'crete-coast']) }, 'Six that tell the trip: mountains, coast, forest and a street'],
  ['select.mark', { photos: P(['young-beech']), as: 'cut' }, 'Nearly the same frame as beech-and-ferns, and darker'],
  ['select.mark', { photos: P(['chateau-frontenac']), as: 'cut' }, 'The wall cuts the frame in half and the sky is blown out'],
  ['select.mark', { photos: P(['mount-ida']), as: 'cut' }, 'Hazy; it says "mountain" less well than alpine-slope'],
  ['select.mark', { photos: P(['mongolian-lake']), as: 'maybe' }, 'Lovely light but a third landscape: worth a look if you want seven'],
];
// One slide of every kind, for the layout and slide operations. As the Board numbers them:
//  1 alpine-slope  2 chateau-frontenac  3 mongolian-lake  4 mount-ida  5 village-street
//  6 young-beech (one photo)   7 two side by side   8 four, divided by a curved line, a straight upright one and a short level one that ends on it
//  9 two and a circle   10 a diagonal quad   11 a diagonal pair   12 inset frames (three windows, two of them grouped)
// 13 a torn strip with a gap   14 a stack of three   15 a stack of two   16-18 a panorama in three
// A second post, Stories, holds village-street and fishing-boats; the group "Forest walk" three photos.
const STUDIO = [
  ['post.assign', { post: 'post1', photos: P(['alpine-slope', 'bay-panorama', 'beech-and-ferns', 'chateau-frontenac', 'crete-coast', 'fishing-boats', 'mongolian-lake', 'mount-ida', 'village-street', 'young-beech']) }],
  ['slide.stack', { slide: '@k:solo crete-coast 1', with: '@k:solo fishing-boats 1' }],
  ['slide.applyTemplate', { slides: ['@k:stack crete-coast 2'], template: 'col-side' }],
  ['slide.stack', { slide: '@k:solo beech-and-ferns 1', with: '@k:solo young-beech 1' }],
  ['slide.applyTemplate', { slides: ['@k:stack beech-and-ferns 2'], template: 'col-curve' }],
  ['slide.applyTemplate', { slides: ['@k:solo bay-panorama 1'], template: 'pano-3' }],
  ['slide.addTemplate', { template: 'col-circle', photos: P(['village-street', 'alpine-slope', 'crete-coast']) }],
  ['slide.addTemplate', { template: 'col-quad', photos: P(['mount-ida', 'mongolian-lake', 'alpine-slope', 'bay-panorama']) }],
  ['slide.addTemplate', { template: 'col-diagonal', photos: P(['fishing-boats', 'crete-coast']) }],
  ['slide.addTemplate', { template: 'inset-three', photos: P(['mongolian-lake', 'beech-and-ferns', 'young-beech', 'village-street']) }],
  ['slide.addTemplate', { template: 'col-tear-gap', photos: P(['chateau-frontenac', 'village-street']) }],
  ['slide.addTemplate', { template: 'stack-plain', photos: P(['beech-and-ferns', 'young-beech', 'village-street']) }],
  ['slide.addTemplate', { template: 'stack-plain', photos: P(['alpine-slope', 'mount-ida']) }],
  ['@order', ['solo alpine-slope 1', 'solo chateau-frontenac 1', 'solo mongolian-lake 1', 'solo mount-ida 1', 'solo village-street 1', 'solo young-beech 1', 'collage crete-coast 2', 'collage beech-and-ferns 2', 'collage village-street 3', 'collage mount-ida 4', 'collage fishing-boats 2', 'collage mongolian-lake 4', 'collage chateau-frontenac 2', 'stack beech-and-ferns 3', 'stack alpine-slope 2', 'split bay-panorama 1']],
  ['layout.drawLine', { slide: '@k:collage beech-and-ferns 2', points: [[0.3, 0], [0.3, 1]] }],
  ['@fill', { slide: '@k:collage beech-and-ferns 2', photo: '@p:mount-ida' }],
  ['layout.drawLine', { slide: '@k:collage beech-and-ferns 3', points: [[0, 0.6], [0.3, 0.6]] }],
  ['@fill', { slide: '@k:collage beech-and-ferns 3', photo: '@p:alpine-slope' }],
  ['layout.groupObjects', { slide: '@k:collage mongolian-lake 4', objects: ['shape:w1', 'shape:w2'] }],
  ['post.destination', { post: 'post1', destination: 'instagram' }],
  ['post.rename', { post: 'post1', name: 'Carousel' }],
  ['post.create', { name: 'Stories' }],
  ['post.assign', { post: 'post2', photos: P(['village-street', 'fishing-boats']) }],
  ['select.group', { ids: P(['beech-and-ferns', 'young-beech', 'village-street']), name: 'Forest walk' }],
];
// studio, with two more lines on slide 8 (one with a right-angled corner in the top right; one slanting from the right
// edge to where the short level line meets the upright one) and the third window on slide 12 made smaller. Added after
// iteration 1, whose tasks round-corner, detach-end and same-size asked for what the studio could not give.
const LINES = STUDIO.concat([
  ['layout.drawLine', { slide: '@k:collage beech-and-ferns 4', points: [[1, 0.3], [0.8, 0.3], [0.8, 0]] }],
  ['@fill', { slide: '@k:collage beech-and-ferns 4', photo: '@p:crete-coast' }],
  ['layout.drawLine', { slide: '@k:collage beech-and-ferns 5', points: [[1, 0.75], [0.3, 0.6]] }],
  ['@fill', { slide: '@k:collage beech-and-ferns 5', photo: '@p:fishing-boats' }],
  ['layout.resizeShape', { slide: '@k:collage mongolian-lake 4', shape: 'w3', scale: 0.7 }],
]);
// studio, with a question the assistant left open in an earlier session.
const ASKED = STUDIO.concat([['@ask', { question: 'Which photo should be the cover of the carousel?', tab: 'sort' }]]);

function specs(photos) {
  const trip = path.join(photos, 'trip'), lisbon = path.join(photos, 'lisbon');
  return {
    fresh: [{ folder: trip, name: 'Trip', mine: true }],
    carousel: [{ folder: trip, name: 'Trip', mine: true, changes: CAROUSEL }],
    studio: [{ folder: trip, name: 'Trip', mine: true, changes: STUDIO }],
    lines: [{ folder: trip, name: 'Trip', mine: true, changes: LINES }],
    marked: [{ folder: trip, name: 'Trip', mine: true, changes: CAROUSEL.concat([['@marks', {}]]) }],
    asked: [{ folder: trip, name: 'Trip', mine: true, changes: ASKED }],
    prior: [{ folder: trip, name: 'Trip', changes: PRIOR }],
    two: [{ folder: trip, name: 'Trip', mine: true, changes: CAROUSEL }, { folder: lisbon, name: 'Lisbon', mine: true, changes: [['post.assign', { post: 'post1', photos: P(['tram', 'rooftops', 'harbour']) }]] }],
  };
}

// build(src, work) -> {fresh: {home, projects}, ...}; makes <work>/photos and <work>/fixtures/<name>.
function build(src, work, only) {
  const photos = path.join(work, 'photos'), sample = path.join(src, 'assets', 'sample');
  fs.mkdirSync(path.join(photos, 'trip'), { recursive: true });
  fs.mkdirSync(path.join(photos, 'lisbon'), { recursive: true });
  for (const f of fs.readdirSync(sample).filter(f => f.endsWith('.jpg'))) fs.copyFileSync(path.join(sample, f), path.join(photos, 'trip', f));
  for (const [from, to] of [['village-street', 'tram'], ['chateau-frontenac', 'rooftops'], ['fishing-boats', 'harbour'], ['bay-panorama', 'river-at-dusk']]) fs.copyFileSync(path.join(sample, from + '.jpg'), path.join(photos, 'lisbon', to + '.jpg'));
  const out = {};
  // What the connector answers with while the app is not running: the app's own handshake and tool list, as the
  // connector keeps them from the last time the app ran (its state/mcp-catalogue.json).
  {
    const code = "const M = require(process.argv[1]); M.createHandler({ http: async () => { throw new Error('no app'); }, log: () => {} })({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }).then(r => process.stdout.write(JSON.stringify({ initialize: r.result, tools: M.TOOLS, accepted: M.PROTOCOLS })));";
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, 'catalogue.json'), require('child_process').execFileSync(process.execPath, ['-e', code, path.join(src, 'src', 'mcp.js')]));
  }
  return Object.entries(specs(photos)).filter(([name]) => !only || only.includes(name)).reduce((p, [name, spec]) => p.then(() => new Promise((resolve, reject) => {
    const home = path.join(work, 'fixtures', name);
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(home, { recursive: true });
    const env = Object.assign({}, process.env); delete env.PHOTOPREP_HOME; delete env.PICPREP_HOME;
    const child = spawn(process.execPath, ['-e', HELPER, src, home, JSON.stringify(spec)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    child.stdout.on('data', d => { so += d; }); child.stderr.on('data', d => { se += d; });
    child.on('exit', code => { if (code) return reject(new Error('fixture ' + name + ': ' + se)); out[name] = { home, projects: JSON.parse(so) }; resolve(); });
  })), Promise.resolve()).then(() => out);
}

module.exports = { build };
