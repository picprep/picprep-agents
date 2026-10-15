'use strict';
// The four scripted people of the personal-assistant evaluation (specs/010 FR-110; SC-003, SC-004, SC-005 mechanical
// part), what each starts with, what each says, and how each run is scored: from files on disk and the app's own
// project, with regexes. No model is asked anything.
//
//   persona.seed(assistantDir)    memory the person already has
//   persona.next(snaps, said)     the person's next words (a string), or null when the conversation is over; snaps holds
//                                 what the files and projects looked like after each turn so far (a person answers what
//                                 they saw), said what the person has said so far
//   persona.score(snaps, run)     [{ what, ok, why }]  (ok is true, false or null = not measured)
const fs = require('fs');
const path = require('path');

// ---------- reading what the run left ----------
const SETTLED_AWAY = ['rejected', 'failed', 'withdrawn', 'undone', 'gone'];
const asList = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const corner = m => {
  if (!m || m.on === false) return null;
  if (m.anchor) return m.anchor;
  if (typeof m.fx === 'number' && typeof m.fy === 'number') return (m.fy < 1 / 3 ? 't' : m.fy > 2 / 3 ? 'b' : 'm') + (m.fx < 1 / 3 ? 'l' : m.fx > 2 / 3 ? 'r' : 'c');
  return 'other';
};
// Every {target, value, state} the project holds: the assistant's changes and the suggestions on file.
function sets(d) {
  const out = [];
  for (const c of d.changes || []) if (!SETTLED_AWAY.includes(c.state)) for (const s of asList(c.set)) if (s && s.target) out.push({ target: s.target, value: s.value, state: c.state });
  for (const [target, v] of Object.entries(d.suggest || {})) out.push({ target, value: v && v.value, state: v && v.state });
  return out;
}
function readProject(home, id) {
  const d = JSON.parse(fs.readFileSync(path.join(home, 'projects', id, 'project.json'), 'utf8'));
  const slides = (d.posts || []).flatMap(p => p.slides || []);
  const marks = slides.map(s => asList(s.mark).map(corner).filter(Boolean));
  const all = sets(d);
  const text = v => (typeof v === 'string' ? v : v && typeof v.text === 'string' ? v.text : v && typeof v.caption === 'string' ? v.caption : null);
  const cap = all.filter(s => /caption/i.test(s.target) && text(s.value)).map(s => text(s.value));
  const meta = all.filter(s => /metadata/i.test(s.target)).map(s => (typeof s.value === 'string' ? s.value : JSON.stringify(s.value)));
  const exp = d.export || {};
  return {
    slides: slides.length, marked: marks.filter(m => m.length).length,
    corners: marks.flat().reduce((o, c) => Object.assign(o, { [c]: (o[c] || 0) + 1 }), {}),
    allBr: marks.some(m => m.length) && marks.flat().every(c => c === 'br'),
    // The caption is the last one filed (a newer one replaces the older).
    caption: cap.length ? cap[cap.length - 1] : (typeof exp.caption === 'string' && exp.caption ? exp.caption : null),
    metadata: meta.length ? meta[meta.length - 1] : null,
  };
}
function readMemory(dir) {
  const out = {}, root = path.join(dir, 'memory');
  const visit = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) visit(path.join(d, e.name), rel + e.name + '/');
      else if (e.name !== '.gitkeep') out[rel + e.name] = fs.readFileSync(path.join(d, e.name), 'utf8');
    }
  };
  if (fs.existsSync(root)) visit(root, '');
  return out;
}
const body = t => (t || '').split('\n').filter(l => l.trim() && !/^\s*<!--.*-->\s*$/.test(l)).join('\n');   // a file's lines but its first comment

// ---------- seeds ----------
const COMMENT = { 'about.md': 'About you: who you are and what you post. Limit 1.5 KB.', 'preferences.md': 'Your preferences: how you like captions, tags and framing. Limit 3 KB.', 'captions.md': 'Captions: past captions to match your voice. Read when needed; no limit.' };
function seed(dir, file, lines) {
  const f = path.join(dir, 'memory', file);
  fs.writeFileSync(f, '<!-- ' + COMMENT[file] + ' -->\n' + lines.join('\n') + '\n');
}
const CAPTIONS = [
  'slow morning above the clouds', 'the bay was glass at 6am', 'found this street by getting lost. best way to see a town',
  'beech forest after rain. everything smelled green 🌿', 'boats waiting for tomorrow', 'windy ridge, cold hands, worth it',
  'crete in october is still warm enough for the sea', 'the light did all the work here', 'no plan today. just walked until the road ended',
  'mountains on both sides of the lake', 'old wall, new light', 'back to the coast again 🌊',
];
const ABOUT = ['Travel and nature photos, posted on Instagram, in English. Wants help with marks, captions and export. (their words, Oct 2026)'];
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- the mechanical checks ----------
const TELLS = [
  [/—/, 'em dash'], [/\bnot just\b[^.]*\bbut\b/i, '"not just X, but Y"'],
  [/\b(captured|pure magic|stunning|journey|vibes|hidden gem)\b/i, 'stock word'],
  [/\?/, 'rhetorical question'],
  [/#\w/, 'hashtag'],
];
const emojiCount = s => (s.match(/\p{Extended_Pictographic}/gu) || []).length;
function captionTells(c) {
  const found = TELLS.filter(([re]) => re.test(c)).map(([, n]) => n);
  if (emojiCount(c) > 1) found.push('more than one emoji');
  if (/[A-Z]/.test(c)) found.push('capital letters (theirs are lowercase)');
  return found;
}

// ---------- personas ----------
const ASK_MARK = n => 'Post ' + n + ' next, please put my watermark on those too';
const personas = {
  'repeat-correction': {
    covers: 'SC-003 (a correction made twice is remembered the third time) and the onboarding limit',
    seed() { /* a new assistant, nothing known */ },
    next(snaps, said) {
      const n = said.length, last = snaps[snaps.length - 1];
      const br = name => !!(last && last.projects[name] && last.projects[name].allBr);
      const asked = L => said.some(s => s.includes('Post ' + L));
      if (n === 0) return 'hi! let\'s get to know each other. I\'ve got a few photos from a trip, they\'re in the project called Post A. can you put my watermark on them?';
      if (n === 1) return 'I post travel and nature photos on instagram, in english. mostly I want help with the watermark and the captions. ' + (br('Post A') ? 'go on with Post A' : 'and could you move the mark to the bottom right? it covers the sky down there on the left. go on with Post A');
      if (!asked('B')) return ASK_MARK('B');
      const fix = 'bottom right again please, same as before';
      if (!asked('C')) return br('Post B') || said[said.length - 1] === fix ? ASK_MARK('C') : fix;
      if (!asked('D')) return br('Post C') || said[said.length - 1] === fix ? 'and now Post D, mark it too' : fix;
      return null;
    },
    score(snaps, run) {
      const last = snaps[snaps.length - 1], mem = last.memory;
      const firstWith = name => { for (const s of snaps) if (s.projects[name] && s.projects[name].marked) return s.projects[name]; return null; };
      const out = [];
      const C = firstWith('Post C'), D = firstWith('Post D');
      // C and D are asked for in a turn that says nothing about where the mark goes; the turn before B's correction (if any) is separate.
      out.push({ what: 'third post marked bottom right without being told', ok: C ? C.allBr : false, why: C ? 'Post C corners ' + JSON.stringify(C.corners) : 'Post C was never marked' });
      out.push({ what: 'fourth post marked bottom right without being told', ok: D ? D.allBr : false, why: D ? 'Post D corners ' + JSON.stringify(D.corners) : 'Post D was never marked' });
      const prefLine = Object.entries(mem).filter(([f]) => /^(preferences|how-you-work)\.md$/.test(f)).flatMap(([f, t]) => t.split('\n').filter(l => /bottom[\s-]*right|lower[\s-]*right|\bbr\b/i.test(l)).map(l => f + ': ' + l.trim()));
      out.push({ what: 'memory holds the mark corner, with its source and a date', ok: prefLine.some(l => /20\d\d|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(l)), why: prefLine.join(' | ').slice(0, 300) || 'no line about the corner in preferences.md or how-you-work.md' });
      const aboutNow = body(mem['about.md']);
      out.push({ what: 'about.md written by the end (onboarding)', ok: aboutNow.length > 20, why: aboutNow.slice(0, 200).replace(/\n/g, ' / ') || 'empty' });
      out.push({ what: 'at most 3 questions before the first change', ok: run.questionsBeforeWork <= 3, why: run.questionsBeforeWork + ' question marks in what it said before its first propose' });
      out.push({ what: 'info: marks right on first try (A, B, C, D)', ok: null, why: ['Post A', 'Post B', 'Post C', 'Post D'].map(n => { const f = firstWith(n); return n.slice(-1) + ':' + (f ? (f.allBr ? 'br' : JSON.stringify(f.corners)) : 'none'); }).join(' ') });
      return out;
    },
  },

  'one-off': {
    covers: 'SC-003, second half: a one-off is not remembered as a habit',
    seed() { },
    next(snaps) {
      const n = snaps.length;
      if (n === 0) return 'hi! I post travel photos on instagram, in english. can you put my watermark on the photos in Post A?';
      if (n === 1) return 'not this time, leave the watermark off on this one';
      if (n === 2) return 'ok. now Post B, put my watermark on those';
      if (n === 3) return 'thanks, that\'s all for today';
      return null;
    },
    score(snaps) {
      const last = snaps[snaps.length - 1], mem = last.memory;
      const RE = /(no|without|off|skip|leave|never|don'?t).{0,40}(watermark|\bmark)|(watermark|\bmark).{0,40}(off|never|skip|not wanted|without)/i;
      const hits = Object.entries(mem).filter(([f]) => f !== 'archive.md' && f !== 'captions.md').flatMap(([f, t]) => body(t).split('\n').filter(l => RE.test(l)).map(l => f + ': ' + l.trim()));
      const A = last.projects['Post A'], B = last.projects['Post B'];
      return [
        { what: 'no lasting preference to leave the watermark off', ok: hits.length === 0, why: hits.join(' | ').slice(0, 300) || 'no such line in memory' },
        { what: 'the next post (B) is marked as usual', ok: !!(B && B.marked > 0), why: B ? B.marked + ' of ' + B.slides + ' slides marked' : 'Post B unknown' },
        { what: 'info: this one (A) left unmarked as asked', ok: null, why: A ? A.marked + ' of ' + A.slides + ' slides marked' : 'unknown' },
      ];
    },
  },

  'caption-voice': {
    covers: 'SC-005, mechanical part only: no AI tells, length like theirs, no hashtags',
    seed(dir) { seed(dir, 'about.md', ABOUT); seed(dir, 'captions.md', CAPTIONS); },
    next(snaps) {
      if (snaps.length === 0) return 'can you write the captions for Post A, B, C, D and E please? one each';
      if (snaps.length === 1) { const miss = ['A', 'B', 'C', 'D', 'E'].filter(l => !(snaps[0].projects['Post ' + l] || {}).caption); return miss.length ? 'I don\'t see the caption for ' + miss.map(l => 'Post ' + l).join(', ') + ' in the export page' : null; }
      return null;
    },
    score(snaps) {
      const last = snaps[snaps.length - 1], med = median(CAPTIONS.map(c => c.length));
      const caps = ['A', 'B', 'C', 'D', 'E'].map(l => ({ post: l, text: (last.projects['Post ' + l] || {}).caption }));
      const found = caps.filter(c => c.text);
      const tells = found.flatMap(c => captionTells(c.text).map(t => c.post + ': ' + t));
      const long = found.filter(c => c.text.length > 2 * med);
      return [
        { what: 'a caption for each of the five posts, in the app\'s Export caption', ok: found.length === 5, why: found.length + ' of 5' },
        { what: 'no AI tells (the picprep-caption list) and no hashtags', ok: found.length > 0 && tells.length === 0, why: tells.join('; ') || 'none' },
        { what: 'length within 2x their median (' + med + ' characters)', ok: found.length > 0 && long.length === 0, why: found.map(c => c.post + ':' + c.text.length).join(' ') },
        { what: 'info: the captions', ok: null, why: found.map(c => c.post + ': ' + JSON.stringify(c.text)).join(' ').slice(0, 600) },
      ];
    },
  },

  compaction: {
    covers: 'SC-004: after the context is compacted, what it remembered still applies',
    seed(dir) {
      seed(dir, 'about.md', ABOUT);
      seed(dir, 'preferences.md', [
        '## Mark', '- The watermark goes in the bottom right corner, on every slide. (their words, Oct 2026)',
        '## Caption', '- Captions in lowercase, no hashtags, one short line. (their words, Oct 2026)',
        '## Export', '- Take the GPS location out of exported files. (their words, Oct 2026)']);
    },
    compactAt: 2,   // the third message is /compact
    next(snaps) {
      const n = snaps.length;
      if (n === 0) return 'hi! can you put my watermark on the photos in Post A?';
      if (n === 1) return 'now look through every one of the five posts, A to E, and look at each photo properly. tell me in detail what is in each one, the light, the mood, anything that could be a problem. I want a long rundown before I decide anything';
      if (n === 2) return '/compact';
      if (n === 3) return 'ok. Post B: put my watermark on it, write the caption, and set up the export so it\'s ready. I\'ll press the button myself';
      return null;
    },
    score(snaps, run) {
      const A = snaps[0].projects['Post A'], last = snaps[snaps.length - 1], B = last.projects['Post B'];
      const metaOk = B && B.metadata && /keep-no-gps|strip|no.?gps|remove/i.test(B.metadata);
      const lc = B && B.caption && !/[A-Z]/.test(B.caption) && !/#/.test(B.caption);
      return [
        { what: 'the context was compacted', ok: run.compacted, why: run.compacted ? 'compaction reported success' : 'no compaction seen' },
        { what: 'before: Post A marked bottom right from memory', ok: !!(A && A.allBr), why: A ? JSON.stringify(A.corners) : 'unknown' },
        { what: 'after: Post B marked bottom right', ok: !!(B && B.allBr), why: B ? JSON.stringify(B.corners) : 'unknown' },
        { what: 'after: caption lowercase, no hashtags', ok: !!lc, why: B && B.caption ? JSON.stringify(B.caption) : 'no caption filed' },
        { what: 'after: location taken out of the export', ok: !!metaOk, why: B && B.metadata ? B.metadata : 'no metadata setting filed' },
      ];
    },
  },
};

module.exports = { personas, readProject, readMemory, captionTells, corner, median, CAPTIONS, body };
