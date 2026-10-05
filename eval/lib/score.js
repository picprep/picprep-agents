'use strict';
// Scores one run against its task's labels, mechanically, from the calls the assistant made and the project on disk
// before and after. No model is asked anything here.
//
//   score(task, run) -> {
//     used: every tool and operation it used (an operation counts even when the app refused it: the choice was made)
//     missed: required items not used        forbidden: items it must not use and did      unnecessary: used, in neither list
//     recall, precision                      over: limits it went past                      errors: calls the app refused
//     order: {looked, status, reported}      expect: [{what, ok, why}]                      goal: every expectation holds }
const { DEFAULT_MAY } = require('../tasks');
const SETTLED_AWAY = ['rejected', 'failed', 'withdrawn', 'undone', 'gone'];

// The items a call uses: its tool; for propose, each operation, `order` for a new order, `set` for field values.
function items(call) {
  const out = [call.tool];
  if (call.tool === 'propose' && call.args) {
    for (const c of Array.isArray(call.args.changes) ? call.args.changes : []) if (c && typeof c.op === 'string') out.push(c.op);
    if (call.args.slides) out.push('order');
    if (call.args.set) out.push('set');
  }
  return out;
}
const flat = list => list.flatMap(x => (typeof x === 'string' ? [x] : x.any));

function score(task, run) {
  const { calls, before, after, timing } = run;
  const counts = {};
  for (const c of calls) for (const i of items(c)) counts[i] = (counts[i] || 0) + 1;
  const used = Object.keys(counts).filter(k => k !== 'Skill');
  const met = m => (typeof m === 'string' ? used.includes(m) : m.any.some(x => used.includes(x)));
  const missed = task.must.filter(m => !met(m)).map(m => (typeof m === 'string' ? m : m.any.join(' | ')));
  const allowed = new Set([...flat(task.must), ...task.may, ...DEFAULT_MAY]);
  const forbidden = used.filter(u => task.not.includes(u));
  const unnecessary = used.filter(u => !allowed.has(u) && !task.not.includes(u));
  // The same with one look at the result allowed (a single view_screenshot), reported beside the strict count.
  const unnecessary1 = unnecessary.filter(u => !(u === 'view_screenshot' && counts[u] === 1));
  const over = Object.entries(task.limits || {}).filter(([k, max]) => (k === 'calls' ? calls.length : counts[k] || 0) > max).map(([k, max]) => k + ' x' + (k === 'calls' ? calls.length : counts[k]) + ' (at most ' + max + ')');
  const firstPropose = calls.findIndex(c => c.tool === 'propose'), lastPropose = calls.map(c => c.tool).lastIndexOf('propose');
  const order = {
    looked: firstPropose < 0 ? null : calls.slice(0, firstPropose).some(c => c.tool === 'view' || c.tool === 'view_screenshot'),
    status: !flat(task.must).includes('status') || firstPropose < 0 ? null
      : calls.slice(0, firstPropose).some(c => c.tool === 'status' && c.args && c.args.working === true) && calls.slice(lastPropose).some(c => c.tool === 'status' && c.args && c.args.working === false),
    reported: !timing.cut,
  };
  const expect = (task.expect || []).map(e => check(e, task, run));
  return {
    used, counts, missed, forbidden, unnecessary, unnecessary1, over, order, expect,
    recall: task.must.length ? (task.must.length - missed.length) / task.must.length : 1,
    precision: used.length ? used.filter(u => allowed.has(u)).length / used.length : 1,
    errors: calls.filter(c => c.error).length, calls: calls.length,
    goal: expect.every(e => e.ok), cut: !!timing.cut, seconds: timing.seconds, cost: timing.cost,
  };
}

const trip = d => d.find(p => p.name === 'Trip') || d[0];
const slideCount = p => p.posts[0].slides.length;
const fresh = (b, a, key) => (a[key] || []).filter(x => !(b[key] || []).some(y => (y.id || y.n) === (x.id || x.n)));
const sameSlides = (b, a) => JSON.stringify(b.posts.map(p => p.slides.map(s => [s.id, s.kind, s.photos]))) === JSON.stringify(a.posts.map(p => p.slides.map(s => [s.id, s.kind, s.photos])));

function check(e, task, run) {
  const b = trip(run.before), a = run.after.find(p => p.id === b.id);
  const res = (ok, why) => ({ what: e.check || [].concat(e.op).join(' | ') + (e.slide ? ' on slide ' + e.slide : '') + (e.offered ? ' (offered)' : ''), ok: !!ok, why });
  if (!a) return res(e.check === 'never', 'the project is gone');
  if (e.op) {
    const ops = [].concat(e.op);
    if (e.offered) {   // the person carries it out: the request must have been taken
      const filed = run.calls.some(c => c.tool === 'propose' && !c.error && (c.args.changes || []).some(x => ops.includes(x.op)));
      return res(filed, filed ? 'filed for the person' : 'never filed');
    }
    const made = fresh(b, a, 'changes').filter(c => ops.includes(c.op) && !SETTLED_AWAY.includes(c.state));
    if (!made.length) return res(false, 'no such change in the project');
    const text = c => JSON.stringify(c.args || {});
    const slide = e.slide ? b.posts[0].slides[e.slide - 1].id : null;
    const ids = (e.photos || []).map(n => b.photos.find(p => p.name === n).id);
    const hit = made.find(c => (!slide || text(c).includes('"' + slide + '"')) && ids.every(i => text(c).includes(i))
      && Object.entries(e.has || {}).every(([k, v]) => JSON.stringify(c.args && c.args[k]).toLowerCase() === JSON.stringify(v).toLowerCase()));
    return res(hit, hit ? 'change ' + hit.id + ' (' + hit.state + ')' : 'made, but not with the expected arguments: ' + made.map(text).join(' ; ').slice(0, 300));
  }
  const newQ = fresh(b, a, 'questions'), newC = fresh(b, a, 'changes').filter(c => !SETTLED_AWAY.includes(c.state)), newO = fresh(b, a, 'offers');
  const post1 = a.posts[0];
  switch (e.check) {
    case 'unchanged': return res(sameSlides(b, a) && !newC.length && !newQ.length && !newO.length, newC.length + ' changes, ' + newQ.length + ' questions, ' + newO.length + ' offers');
    case 'unchanged-but-questions': return res(sameSlides(b, a) && !newC.length && !newO.length, newC.length + ' changes, ' + newO.length + ' offers');
    case 'six-in-post': { const n = new Set(post1.slides.flatMap(s => s.photos)).size; return res(n === 6, n + ' photos in the post'); }
    case 'order-restored': return res(JSON.stringify(post1.slides.map(s => s.id)) === JSON.stringify(b.posts[0].slides.map(s => s.id)) && fresh(b, a, 'changes').length > 0, 'order ' + post1.slides.map(s => s.photos[0]).join(', '));
    case 'boats-first': return res(post1.slides[0].photos.includes('fishing-boats.jpg'), 'first slide: ' + post1.slides[0].photos.join('+'));
    case 'lisbon-untouched': { const lb = run.before.find(p => p.name === 'Lisbon'), la = run.after.find(p => p.name === 'Lisbon'); return res(la && sameSlides(lb, la) && la.changes.length === lb.changes.length, 'Lisbon'); }
    case 'asked-not-changed': return res(newQ.length >= 1 && sameSlides(b, a) && !newC.length, newQ.length + ' questions, ' + newC.length + ' changes');
    case 'project-kept': return res(true, 'the project is there');
    case 'second-post-for-x': { const x = a.posts.find(p => p.destination === 'x'); return res(a.posts.length === 2 && x && x.id !== post1.id && post1.destination === 'instagram' && x.slides.length > 0, a.posts.map(p => p.name + ':' + p.destination + ':' + p.slides.length).join(', ')); }
    case 'marks-bottom-right': { const ok = post1.slides.every(s => [].concat(s.mark || [null]).every(m => m && m.on && m.anchor === 'br')); return res(ok, post1.slides.map(s => (s.mark ? [].concat(s.mark).map(m => m && m.anchor).join('/') : 'none')).join(', ')); }
    case 'slide3-lighter-or-asked': { const s3 = b.posts[0].slides[2], now = post1.slides.find(s => s.id === s3.id); return res(newQ.length > 0 || !now || now.photos.length < 3 || now.kind !== s3.kind || newC.some(c => JSON.stringify(c.args || {}).includes(s3.id)), now ? now.kind + ' of ' + now.photos.length : 'slide replaced'); }
    case 'one-choice-question': return res(newQ.length === 1 && newQ[0].kind === 'choice' && (newQ[0].options || []).length === 2 && !newC.length, JSON.stringify(newQ).slice(0, 200));
    case 'one-text-question': return res(newQ.length === 1 && newQ[0].kind === 'text' && !newC.length, JSON.stringify(newQ).slice(0, 200));
    case 'question-withdrawn': { const q = b.questions[0], now = a.questions.find(x => x.id === q.id); return res(!now || now.state === 'withdrawn', now ? now.state : 'gone'); }
    case 'one-slide-more': return res(slideCount(a) === slideCount(b) + 1, slideCount(b) + ' -> ' + slideCount(a));
    case 'same-slide-count': return res(slideCount(a) === slideCount(b), slideCount(b) + ' -> ' + slideCount(a));
    default: throw new Error('unknown check ' + e.check);
  }
}

module.exports = { score, items };
