'use strict';
// The eval's tasks: what a person says, the state it is said in, and - written before any run - which tools and
// operations the right answer uses (must), may use (may), and must not use (not). `node eval/eval.js labels` writes
// them out as eval/evals.json and checks that every tool and every operation is some task's `must` and some task's
// `not` (its near miss).
//
// An item is a tool name (view, ask, ...), an operation (layout.splitCell, ...; `order` is propose's `slides`,
// `set` its field values), or {any: [...]}: at least one of these.
// Every task may also use: view, list_projects, get_outcome, status, show_tab. Anything else that is used and is in
// neither must nor may counts as unnecessary; anything in `not` as forbidden.
//
// fixture: the starting state (eval/lib/fixtures.js). The studio's slides, as the Board numbers them:
//   1 alpine-slope  2 chateau-frontenac  3 mongolian-lake  4 mount-ida  5 village-street  6 young-beech (one photo each)
//   7 two side by side  8 four, divided by a curved line, an upright line and a short level one  9 two and a circle
//   10 a diagonal quad  11 a diagonal pair  12 inset frames (three windows)  13 a torn strip with a gap
//   14 a stack of three  15 a stack of two  16-18 a panorama in three.   Second post: Stories.
// expect: what must be true of the project afterwards (eval/lib/score.js): a change of that op, on that slide
//   (Board number) or those photos, applied - or offered, for the operations only the person carries out.
const any = (...x) => ({ any: x });
const T = [];
const add = (name, fixture, prompt, must, o = {}) => T.push(Object.assign({ name, fixture, prompts: [].concat(prompt), must, may: [], not: [], expect: [] }, o));
const S = 'studio', C = 'carousel';
const P = 'propose';

// --- the tools, and what only the person does ---------------------------------------------------------------------
add('pick-six', 'fresh', 'I have my trip photos open in PicPrep. Pick the best 6 for an Instagram carousel and tell me why.',
  ['view', 'view_screenshot', 'status', P, any('post.assign', 'set')],
  { tab: 'select', may: ['post.destination', 'select.mark', 'order', 'ask', 'choose'], not: ['post.create'], limits: { view_screenshot: 4 }, expect: [{ check: 'six-in-post' }],
    says: 'Six photos are in the post, each choice explained from what the photos show (it has to look at them: a screenshot), and the person is told the picks are theirs to keep or reject.' });
add('left-out-why', 'prior', 'Last time you went through these photos and left some out. Which ones, and why?',
  ['view'], { tab: 'select', not: [P, 'ask', 'choose', 'withdraw', 'view_screenshot'], expect: [{ check: 'unchanged' }],
    says: 'Names young-beech, chateau-frontenac and mount-ida as cut and mongolian-lake as a maybe, with the reasons recorded in the app (near duplicate and darker; wall cuts the frame, sky blown out; hazy; a third landscape), not invented ones. Changes nothing.' });
add('export-it', C, 'Export it.',
  [], { tab: 'export', may: ['show_tab', 'ask'], not: [P, 'withdraw', 'choose'], expect: [{ check: 'unchanged-but-questions' }],
    says: 'Says plainly that it cannot export, that only the person can, and points them to Export (ideally bringing the window there). Never says or implies files were written.' });
add('undo-that', C, ['Move the fishing boats slide to the front.', 'Actually, undo what you just did.'],
  ['view', P, 'order', 'withdraw'], { limits: { order: 1 }, expect: [{ check: 'order-restored' }],
    says: 'The first request moves the slide; the second takes that same change back with the tool for it (not a second change that moves it again), and the order is as it was.' });
add('not-running', C, 'How many photos are in my trip project?',
  [any('list_projects', 'view', 'open_project')], { app: 'off', not: [P, 'ask', 'choose'], limits: { calls: 4 },
    says: 'PicPrep is not running and cannot be started. It says so in plain words and what to do (install or open PicPrep, then ask again). It gives no number.' });
add('no-project-open', 'two', 'Move the fishing boats slide to the front of the carousel.',
  ['view', P, 'order'], { app: 'home', may: ['open_project'], not: ['ask', 'choose'], expect: [{ check: 'boats-first' }, { check: 'lisbon-untouched' }],
    says: 'No project is open (the window is on the home screen) and there are two projects. It finds the one with the fishing boats (Trip) and moves that slide first; Lisbon is untouched.' });
add('viewing-only', C, 'Move the fishing boats slide to the front.',
  ['view'], { licence: 'none', may: [P, 'order'], not: ['withdraw', 'ask', 'choose'], limits: { propose: 1 }, expect: [{ check: 'unchanged' }],
    says: 'The copy has no subscription or trial, so nothing can be changed. It says that, and that only the person can enter a licence, in Settings, Licence. It does not claim the slide moved and does not keep retrying.' });
add('favourite', C, 'Put whichever of the last two slides I like best at the front.',
  ['view', any('ask', 'choose')], { not: [P, 'order'], expect: [{ check: 'asked-not-changed' }],
    says: 'It cannot know which one they like best: it asks through the app (a question in their window, best with the two as options) and changes nothing until answered.' });
add('delete-project', C, "Delete this project, I'm done with it.",
  [P, 'project.delete'], { not: ['post.delete', 'post.unassign', 'select.mark', 'withdraw'], expect: [{ check: 'project-kept' }],
    says: 'Deleting is the person\'s alone: it files the request so the app asks them to confirm, and says they must confirm it in the app. It never says the project is deleted.' });
add('x-as-well', C, 'Make this ready for X as well.',
  ['view', P, 'post.create'], { may: ['post.moveSlide', 'post.assign', 'ask', 'choose', 'order', 'post.rename', 'post.mute'], not: ['post.destination'], expect: [{ check: 'second-post-for-x' }],
    says: 'A second post for X beside the Instagram one (which stays for Instagram), holding the same slides or photos. Says what it made and that the person reviews it.' });
add('watermark-all', C, 'Add my watermark bottom right on all slides.',
  ['view', 'status', P, 'set'], { tab: 'watermark', may: ['view_screenshot'], not: ['watermark.autoContrast', 'ask', 'choose'], limits: { propose: 2 }, expect: [{ check: 'marks-bottom-right' }],
    says: 'Every slide of the post carries the mark, anchored bottom right, set in one change (not one call per slide).' });
add('cramped', C, 'The third slide feels cramped, can you fix it?',
  ['view', any(P, 'ask', 'choose')], { may: ['view_screenshot', 'slide.unstack', 'slide.pullPhoto', 'slide.setType', 'slide.applyTemplate', 'layout.applyTemplate', 'layout.removeCell', 'ask', 'choose'], limits: { view_screenshot: 2 }, expect: [{ check: 'slide3-lighter-or-asked' }],
    says: 'Slide 3 is a stack of three photos. Either it gives the slide more room in one sensible change (fewer photos on it, or a roomier layout) and explains, or it asks which the person wants.' });
add('circle-covers', S, 'On slide 9, does the circle cover anything important in the photos under it?',
  ['view_screenshot'], { not: [P, 'ask', 'choose'], limits: { view_screenshot: 3 }, expect: [{ check: 'unchanged' }],
    says: 'Only the picture can answer this: it looks at slide 9 and says what the circle covers. Changes nothing.' });
add('count-slides', S, 'How many slides are in the carousel, and which of them hold more than one photo?',
  ['view'], { not: ['view_screenshot', P, 'ask', 'choose'], expect: [{ check: 'unchanged' }],
    says: '18 slides as the Board counts them (16 if the panorama is counted once; either with the reason); slides 7 to 15 hold more than one photo. Read from the project, no screenshot.' });
add('take-me-to-export', S, 'Take me to the export page.',
  ['show_tab'], { not: [P, 'ask', 'choose', 'view_screenshot'], expect: [{ check: 'unchanged' }], says: 'Brings the window to Export, and says so. Nothing else.' });
add('open-lisbon', 'two', 'Open my Lisbon project.',
  ['open_project'], { app: 'home', not: [P, 'ask', 'choose'], expect: [{ check: 'unchanged' }], says: 'Opens Lisbon in the window and says so.' });
add('which-projects', 'two', 'Which projects do I have in PicPrep?',
  ['list_projects'], { app: 'home', not: [P, 'open_project', 'ask', 'choose', 'view_screenshot'], expect: [{ check: 'unchanged' }], says: 'Lisbon (4 photos) and Trip (10 photos). Opens neither.' });
add('choose-closer', S, "I can't decide whether slide 2 or slide 3 should close the carousel. Put the question to me in the app with both options so I can answer later.",
  ['choose'], { not: ['ask', P], expect: [{ check: 'one-choice-question' }], says: 'One question with the two options, left in the app; it does not wait for the answer or decide itself.' });
add('ask-mood', S, "Ask me in the app what mood I'm going for with the captions. I'll answer when I'm back.",
  ['ask'], { not: ['choose', P], expect: [{ check: 'one-text-question' }], says: 'One open question in the person\'s own words, left in the app; no options invented, nothing changed, no long wait.' });
add('take-question-back', 'asked', 'Never mind the question you left me about the cover, take it back.',
  ['view', 'withdraw'], { not: [P, 'ask', 'choose'], expect: [{ check: 'question-withdrawn' }], says: 'The open question about the cover is withdrawn.' });
add('did-i-answer', 'asked', 'Did I ever answer your question about the cover?',
  [any('get_outcome', 'view')], { not: [P, 'ask', 'choose', 'withdraw'], expect: [{ check: 'unchanged' }], says: 'No: the question is still open. It does not ask again or take it back.' });

// --- one cell, one seam: slide 7 (two side by side) ------------------------------------------------------------
add('wider-boats', S, 'On slide 7, give the boats about two thirds of the width.', ['view', P, 'layout.moveSeam'],
  { not: ['layout.splitCell', 'layout.placeSeparator', 'layout.moveSeparator', 'layout.drawLine'], expect: [{ op: 'layout.moveSeam', slide: 7 }] });
add('split-right-cell', S, 'Slide 7: divide the right-hand cell in two, one above the other, so I can add another photo there.', ['view', P, 'layout.splitCell'],
  { not: ['layout.drawLine', 'slide.split', 'layout.drawShape'], expect: [{ op: 'layout.splitCell', slide: 7, has: { cell: 'b', dir: 'col' } }] });
add('swap-two', S, 'On slide 7 swap the two photos around.', ['view', P, 'layout.swapPhotos'],
  { not: ['layout.mirrorLayout', 'order', 'slide.putPhoto'], expect: [{ op: 'layout.swapPhotos', slide: 7 }] });
add('mirror', S, 'Flip the whole layout of slide 9 left to right.', ['view', P, 'layout.mirrorLayout'],
  { not: ['layout.swapPhotos', 'layout.rotateLayout', 'layout.rotateFrame'], expect: [{ op: 'layout.mirrorLayout', slide: 9, has: { axis: 'x' } }] });
add('quarter-turn', S, 'Turn the layout of slide 7 a quarter turn so the photos sit one above the other. Keep the slide portrait.', ['view', P, 'layout.rotateLayout'],
  { not: ['layout.rotateFrame', 'layout.mirrorLayout'], expect: [{ op: 'layout.rotateLayout', slide: 7 }] });
add('landscape', S, 'Make slide 7 landscape instead of portrait.', ['view', P, 'layout.rotateFrame'],
  { not: ['layout.rotateLayout'], expect: [{ op: 'layout.rotateFrame', slide: 7 }] });
add('one-cell-fewer', S, 'Slide 10 has four photos. Drop the cell with the bay panorama so the other three share the space.', ['view', P, 'layout.removeCell'],
  { not: ['slide.pullPhoto', 'layout.removeSeparator', 'post.unassign'], expect: [{ op: 'layout.removeCell', slide: 10, has: { cell: 'd' } }] });
add('sixty-forty', S, 'Give slide 7 the 60/40 two-photo layout.', ['view', P, any('layout.applyTemplate', 'slide.applyTemplate')],
  { not: ['layout.moveSeam', 'slide.addTemplate', 'slide.newSlide'], expect: [{ op: ['layout.applyTemplate', 'slide.applyTemplate'], slide: 7 }] });
add('line-across', S, 'Draw a straight line across slide 7 from the left edge to the right edge, about a third of the way down.', ['view', P, 'layout.drawLine'],
  { not: ['layout.splitCell', 'layout.drawShape', 'layout.drawClosedShape'], expect: [{ op: 'layout.drawLine', slide: 7 }] });
add('triangle', S, 'Draw a triangle in the middle of slide 7 that cuts into the photos, so I can put a third photo in it.', ['view', P, 'layout.drawClosedShape'],
  { not: ['layout.drawShape', 'layout.drawLine'], expect: [{ op: 'layout.drawClosedShape', slide: 7 }] });

// --- lines: slide 8 (a curved line c1, an upright line s1, a short level line that ends on s1) --------------------
add('straighten-curve', S, 'On slide 8, take the curve out of the curved line. Leave the other lines alone.', ['view', P, 'layout.straightenSeparator'],
  { not: ['layout.resetSeparators', 'layout.removeSeparator', 'layout.removeHandle'], expect: [{ op: 'layout.straightenSeparator', slide: 8, has: { separator: 'c1' } }] });
add('reset-lines', S, 'Slide 8 is a mess. Put every line back to a plain straight line between its two ends.', ['view', P, 'layout.resetSeparators'],
  { not: ['layout.removeSeparator', 'layout.applyTemplate', 'slide.applyTemplate'], limits: { 'layout.straightenSeparator': 0 }, expect: [{ op: 'layout.resetSeparators', slide: 8 }] });
add('lock-curve', S, "Lock the curved line on slide 8 so I don't move it by accident.", ['view', P, 'layout.lockSeparator'],
  { not: ['layout.groupObjects'], expect: [{ op: 'layout.lockSeparator', slide: 8, has: { separator: 'c1', locked: true } }] });
add('remove-line', S, 'Remove the short level line on slide 8, so the two photos it divides become one.', ['view', P, 'layout.removeSeparator'],
  { not: ['layout.resetSeparators', 'layout.removeCell', 'layout.straightenSeparator'], expect: [{ op: 'layout.removeSeparator', slide: 8 }] });
add('bend-line', S, 'On slide 8, add a bend point in the middle of the upright straight line and pull it a little to the right.', ['view', P, 'layout.addHandle', 'layout.moveHandle'],
  { not: ['layout.moveSeparator', 'layout.drawLine'], expect: [{ op: 'layout.addHandle', slide: 8 }, { op: 'layout.moveHandle', slide: 8 }] });
add('sharp-and-fewer', S, "On slide 8's curved line, make the bend a sharp corner instead of a smooth curve.", ['view', P, 'layout.setHandle'],
  { not: ['layout.straightenSeparator', 'layout.roundCorner', 'layout.removeHandle'], expect: [{ op: 'layout.setHandle', slide: 8, has: { type: 'corner' } }] });
add('drop-bend', S, "Take the bend point out of slide 8's curved line.", ['view', P, any('layout.removeHandle', 'layout.straightenSeparator')],
  { not: ['layout.removeSeparator', 'layout.resetSeparators'], expect: [{ op: ['layout.removeHandle', 'layout.straightenSeparator'], slide: 8 }] });
add('round-corner', 'lines', 'On slide 8, the line in the top right corner bends at a right angle. Round that corner off, radius about 40.', ['view', P, 'layout.roundCorner'],
  { not: ['layout.setHandle', 'layout.addHandle'], expect: [{ op: 'layout.roundCorner', slide: 8 }] });
add('slide-end', S, 'On slide 8, slide the top end of the upright straight line further to the left along the top edge. The bottom end stays.', ['view', P, 'layout.moveSeparatorEnd'],
  { not: ['layout.moveSeparator', 'layout.placeSeparator'], expect: [{ op: 'layout.moveSeparatorEnd', slide: 8 }] });
add('move-line', S, 'Move the whole curved line on slide 8 a bit to the right, shape unchanged.', ['view', P, 'layout.moveSeparator'],
  { not: ['layout.moveSeparatorEnd', 'layout.moveHandle', 'layout.placeSeparator'], expect: [{ op: 'layout.moveSeparator', slide: 8, has: { separator: 'c1' } }] });
add('place-line', S, 'Put the upright straight line on slide 8 at exactly 25% across and tilt it 10 degrees.', ['view', P, 'layout.placeSeparator'],
  { not: ['layout.moveSeparatorEnd'], expect: [{ op: 'layout.placeSeparator', slide: 8 }] });
add('move-junction', S, 'On slide 8, the point where the short level line meets the upright one: move that meeting point up a little.', ['view', P, 'layout.moveJunction'],
  { not: ['layout.moveSeparator', 'layout.detachSeparator'], expect: [{ op: 'layout.moveJunction', slide: 8 }] });
add('detach-end', 'lines', 'On slide 8, the long slanting line ends where the short level line meets the upright one. Take that end off that meeting point.', ['view', P, 'layout.detachSeparator'],
  { not: ['layout.removeSeparator', 'layout.moveJunction'], expect: [{ op: 'layout.detachSeparator', slide: 8 }] });
add('cut-and-join', S, 'Cut the curved line on slide 8 in two at its middle. Then join the two halves back into one line: I only want to see that it works.', ['view', P, 'layout.splitSeparator', 'layout.mergeSeparators'],
  { not: ['layout.drawLine', 'layout.removeSeparator', 'withdraw'], expect: [{ op: 'layout.splitSeparator', slide: 8 }, { op: 'layout.mergeSeparators', slide: 8 }] });

// --- shapes: slide 9 (a circle "o" over two photos) ---------------------------------------------------------------
add('add-box', S, 'Add a small framed box in the top left corner of slide 9 for another photo.', ['view', P, 'layout.drawShape'],
  { not: ['layout.drawClosedShape', 'layout.splitCell', 'layout.insetFrames'], expect: [{ op: 'layout.drawShape', slide: 9, has: { shape: 'rect' } }] });
add('remove-circle', S, 'Take the circle off slide 9.', ['view', P, 'layout.removeShape'],
  { not: ['layout.removeCell', 'layout.removeSeparator', 'slide.pullPhoto'], expect: [{ op: 'layout.removeShape', slide: 9 }] });
add('circle-cuts', S, 'Make the circle on slide 9 cut into the photos under it instead of sitting on top of them.', ['view', P, 'layout.setShapeMode'],
  { not: ['layout.restackShape', 'layout.setShapeInside'], expect: [{ op: 'layout.setShapeMode', slide: 9, has: { mode: 'cut' } }] });
add('circle-past-edge', S, 'Keep the circle on slide 9 inside the card, so it can never run past the edge.', ['view', P, 'layout.setShapeInside'],
  { not: ['layout.setShapeMode'], may: ['layout.moveShape'], expect: [{ op: 'layout.setShapeInside', slide: 9, has: { inside: true } }] });
add('circle-up-bigger', S, 'Move the circle on slide 9 up a bit and make it about 20% bigger.', ['view', P, any('layout.moveShape', 'layout.transformObjects'), any('layout.resizeShape', 'layout.transformObjects')],
  { not: ['layout.drawShape', 'layout.removeShape'], expect: [{ op: ['layout.moveShape', 'layout.transformObjects'], slide: 9 }, { op: ['layout.resizeShape', 'layout.transformObjects'], slide: 9 }] });

// --- objects: slide 12 (inset frames: windows w1, w2, w3; w1 and w2 grouped) --------------------------------------
add('tilt-window', S, 'Tilt the third little window on slide 12 by 15 degrees.', ['view', P, any('layout.turnShape', 'layout.transformObjects')],
  { not: ['layout.rotateLayout', 'layout.rotateFrame'], expect: [{ op: ['layout.turnShape', 'layout.transformObjects'], slide: 12 }] });
add('window-to-front', S, 'On slide 12, bring the first window in front of the others.', ['view', P, 'layout.restackShape'],
  { not: ['layout.moveShape', 'order', 'layout.setShapeMode'], expect: [{ op: 'layout.restackShape', slide: 12 }] });
add('align-and-space', S, 'Line the three windows on slide 12 up on their left edges and space them evenly down the slide.', ['view', P, 'layout.alignObjects', 'layout.distributeObjects'],
  { not: ['layout.moveShape', 'layout.insetFrames'], expect: [{ op: 'layout.alignObjects', slide: 12, has: { edge: 'left' } }, { op: 'layout.distributeObjects', slide: 12, has: { axis: 'down' } }] });
add('same-size', 'lines', 'Make the windows on slide 12 all the same size as the first one.', ['view', P, 'layout.matchSize'],
  { not: ['layout.resizeShape', 'layout.insetFrames'], expect: [{ op: 'layout.matchSize', slide: 12 }] });
add('group-all', S, 'Group all three windows on slide 12 so they move as one.', ['view', P, 'layout.groupObjects'],
  { not: ['select.group', 'layout.lockSeparator'], expect: [{ op: 'layout.groupObjects', slide: 12 }] });
add('ungroup', S, 'Two of the windows on slide 12 are grouped. Ungroup them.', ['view', P, 'layout.ungroupObjects'],
  { not: ['select.ungroup', 'layout.removeShape'], expect: [{ op: 'layout.ungroupObjects', slide: 12 }] });
add('copy-window', S, 'Duplicate the third window on slide 12, with the copy a little below it.', ['view', P, 'layout.duplicateObjects'],
  { not: ['slide.duplicate', 'layout.drawShape'], expect: [{ op: 'layout.duplicateObjects', slide: 12 }] });
add('shrink-together', S, 'Shrink all three windows on slide 12 together to 80% and nudge them to the left, keeping their arrangement.', ['view', P, 'layout.transformObjects'],
  { not: ['layout.resizeShape', 'layout.moveShape', 'layout.insetFrames'], expect: [{ op: 'layout.transformObjects', slide: 12 }] });
add('four-windows', S, 'Slide 12: four windows in a grid instead of three, with rounded corners and a shadow.', ['view', P, 'layout.insetFrames'],
  { may: ['slide.putPhoto'], not: ['layout.duplicateObjects', 'layout.drawShape', 'slide.applyTemplate'], expect: [{ op: 'layout.insetFrames', slide: 12 }] });

// --- diagonals and the torn strip --------------------------------------------------------------------------------
add('gentle-slant', S, 'The diagonal on slide 11 goes corner to corner. Make it a gentle slant, and slanting the other way.', ['view', P, 'layout.diagonalCut', 'layout.flipCut'],
  { not: ['layout.mirrorLayout', 'layout.rotateLayout', 'layout.applyTemplate'], expect: [{ op: 'layout.diagonalCut', slide: 11, has: { cut: 'slant' } }, { op: 'layout.flipCut', slide: 11 }] });
add('rotate-quad', S, 'On slide 10, move each of the four photos one triangle on, clockwise.', ['view', P, 'layout.rotateQuadOrder'],
  { not: ['layout.rotateLayout', 'layout.swapPhotos', 'layout.rotateFrame'], expect: [{ op: 'layout.rotateQuadOrder', slide: 10 }] });
add('white-gap', S, 'Fill the gap of the torn strip on slide 13 with plain white.', ['view', P, 'layout.stripGap'],
  { not: ['slide.setType', 'set'], expect: [{ op: 'layout.stripGap', slide: 13, has: { fill: 'colour' } }] });

// --- whole slides ---------------------------------------------------------------------------------------------------
add('stack-two', S, 'Put slides 2 and 3 together as one stacked slide.', ['view', P, 'slide.stack'],
  { not: ['slide.makeCollage', 'slide.addTemplate', 'slide.makeBeforeAfter'], expect: [{ op: 'slide.stack', slide: 2 }] });
add('unstack', S, 'Break the stack on slide 14 up into one slide per photo.', ['view', P, 'slide.unstack'],
  { not: ['slide.pullPhoto', 'slide.split'], expect: [{ op: 'slide.unstack', slide: 14 }] });
add('pull-one', S, 'Take just the village street photo out of the stack on slide 14 into a slide of its own.', ['view', P, 'slide.pullPhoto'],
  { not: ['slide.unstack', 'post.unassign', 'layout.removeCell'], expect: [{ op: 'slide.pullPhoto', slide: 14 }] });
add('swap-stack', S, 'On slide 15, swap which photo is on top.', ['view', P, any('slide.swapStack', 'layout.swapPhotos')],
  { not: ['order', 'layout.mirrorLayout'], expect: [{ op: ['slide.swapStack', 'layout.swapPhotos'], slide: 15 }] });
add('make-panorama', S, 'Spread the lake photo on slide 3 across three slides as a panorama.', ['view', P, any('slide.split', 'slide.setType')],
  { not: ['layout.splitCell', 'slide.duplicate', 'slide.applyTemplate'], expect: [{ op: ['slide.split', 'slide.setType'], slide: 3 }] });
add('panorama-in-two', S, 'The bay panorama at the end takes three slides. Make it two.', ['view', P, any('slide.split', 'slide.setType')],
  { not: ['slide.unsplit', 'layout.removeCell'], expect: [{ op: ['slide.split', 'slide.setType'], slide: 16 }] });
add('panorama-whole', S, 'Post the bay panorama as one whole photo again, not split.', ['view', P, any('slide.unsplit', 'slide.setType')],
  { not: ['slide.unstack', 'slide.reframe'], expect: [{ op: ['slide.unsplit', 'slide.setType'], slide: 16 }] });
add('blur-fit', S, 'Slide 2: show the whole photo over a blurred copy of itself instead of cropping it.', ['view', P, any('slide.blurFit', 'slide.setType')],
  { not: ['slide.reframe'], expect: [{ op: ['slide.blurFit', 'slide.setType'], slide: 2 }] });
add('reframe-four', S, "Slides 1 to 4: fit each whole photo inside its frame, don't crop. Plain background, no blur.", ['view', P, 'slide.reframe'],
  { not: ['slide.blurFit'], limits: { 'slide.reframe': 1 }, expect: [{ op: 'slide.reframe', slide: 1, has: { fit: true } }] });
add('retype-three', S, 'Change slides 4, 5 and 6 to blurred-edge slides in one go.', ['view', P, 'slide.setType'],
  { not: ['slide.reframe'], limits: { 'slide.blurFit': 0, 'slide.setType': 1 }, expect: [{ op: 'slide.setType', slide: 4 }] });
add('gear-card', S, 'Add a card with the camera settings right after slide 1.', ['view', P, any('slide.makeCard', 'slide.toolNew', 'slide.addTemplate')],
  { not: ['slide.toolApply', 'slide.setType'], expect: [{ op: ['slide.makeCard', 'slide.toolNew', 'slide.addTemplate'] }, { check: 'one-slide-more' }] });
add('card-in-place', S, 'Turn slide 2 itself into an EXIF card: I want the settings card instead of the photo slide, not an extra slide.', ['view', P, 'slide.toolApply'],
  { may: ['view'], not: ['slide.makeCard', 'slide.toolNew', 'slide.addTemplate'], expect: [{ op: 'slide.toolApply' }, { check: 'same-slide-count' }] });
add('before-after', S, 'Make a before/after slide from slides 1 and 4: slide 1 is the before.', ['view', P, any('slide.makeBeforeAfter', 'slide.toolNew')],
  { not: ['slide.stack', 'slide.makeCollage'], expect: [{ op: ['slide.makeBeforeAfter', 'slide.toolNew'] }] });
add('collage-from-stack', S, "Make a collage out of slide 14's three photos as a new slide next to it. Keep the stack as it is.", ['view', P, 'slide.makeCollage'],
  { not: ['slide.setType', 'slide.applyTemplate', 'slide.duplicate'], expect: [{ op: 'slide.makeCollage', slide: 14 }, { check: 'one-slide-more' }] });
add('empty-copy', S, "Add an empty slide with slide 9's layout, so I can drop other photos into it.", ['view', P, any('slide.copyLayout', 'slide.pasteLookNew')],
  { not: ['slide.duplicate', 'slide.pasteLook'], expect: [{ op: ['slide.copyLayout', 'slide.pasteLookNew'], slide: 9 }] });
add('blank-grid', S, 'Add a blank four-photo grid slide at the end. I will fill it myself.', ['view', P, any('slide.newSlide', 'slide.addTemplate')],
  { not: ['slide.applyTemplate', 'slide.duplicate', 'slide.copyLayout'], expect: [{ op: ['slide.newSlide', 'slide.addTemplate'] }, { check: 'one-slide-more' }] });
add('template-on-stack', S, 'Use the "Three columns" template from the library on slide 14.', ['view', P, any('slide.applyTemplate', 'layout.applyTemplate', 'slide.toolApply')],
  { not: ['slide.addTemplate', 'slide.makeCollage', 'slide.newSlide'], expect: [{ op: ['slide.applyTemplate', 'layout.applyTemplate', 'slide.toolApply'], slide: 14 }, { check: 'same-slide-count' }] });
add('new-from-tool', S, 'Add a new slide at the very start, made from the side-by-side template, with the alpine slope and the chateau.', ['view', P, any('slide.toolNew', 'slide.addTemplate')],
  { not: ['slide.applyTemplate', 'slide.stack'], expect: [{ op: ['slide.toolNew', 'slide.addTemplate'] }, { check: 'one-slide-more' }] });
add('paste-look', S, "Copy slide 9's look onto slides 7 and 11.", ['view', P, 'slide.pasteLook'],
  { not: ['slide.applyTemplate', 'layout.applyTemplate', 'slide.pasteLookNew', 'slide.copyLayout'], limits: { 'slide.pasteLook': 1 }, expect: [{ op: 'slide.pasteLook', slide: 9 }] });
add('duplicate', S, 'Duplicate slide 7.', ['view', P, 'slide.duplicate'],
  { not: ['slide.copyLayout', 'slide.makeCollage', 'post.moveSlide'], expect: [{ op: 'slide.duplicate', slide: 7 }] });
add('photo-into-circle', S, 'Put the mount-ida photo into the circle on slide 9.', ['view', P, 'slide.putPhoto'],
  { not: ['layout.swapPhotos', 'photos.add'], expect: [{ op: 'slide.putPhoto', slide: 9, photos: ['mount-ida.jpg'] }] });
add('history-back', S, ['Swap the two photos on slide 7, then flip the layout of slide 9 left to right.', 'Go back in the History to just before the flip.'], ['view', P, 'layout.swapPhotos', 'layout.mirrorLayout', 'history.jump'],
  { may: ['withdraw'], not: [], expect: [{ op: 'history.jump', offered: true }] });

// --- picking: photos, marks, groups -------------------------------------------------------------------------------
add('mark-some', 'fresh', 'Mark the two beech forest photos as maybes and cut mount-ida.', ['view', P, 'select.mark'],
  { tab: 'select', not: ['post.unassign', 'select.group', 'post.assign'], expect: [{ op: 'select.mark', photos: ['beech-and-ferns.jpg', 'young-beech.jpg'], has: { as: 'maybe' } }, { op: 'select.mark', photos: ['mount-ida.jpg'], has: { as: 'cut' } }] });
add('group-coast', 'fresh', "Group bay-panorama, crete-coast and fishing-boats as 'Coast'. I want at most two of them in the end.", ['view', P, 'select.group'],
  { tab: 'select', not: ['select.mark', 'post.create', 'layout.groupObjects', 'post.assign'], expect: [{ op: 'select.group', photos: ['bay-panorama.jpg', 'crete-coast.jpg', 'fishing-boats.jpg'], has: { name: 'Coast', target: 2 } }] });
add('leave-group', S, 'Take village-street out of the Forest walk group.', ['view', P, 'select.removeFromGroup'],
  { tab: 'select', not: ['select.ungroup', 'select.mark', 'post.unassign', 'layout.ungroupObjects'], expect: [{ op: 'select.removeFromGroup', photos: ['village-street.jpg'] }] });
add('delete-group', S, "I don't need the Forest walk group any more. Remove the group; keep the photos where they are.", ['view', P, 'select.ungroup'],
  { tab: 'select', not: ['select.removeFromGroup', 'select.mark', 'post.unassign', 'layout.ungroupObjects'], expect: [{ op: 'select.ungroup' }] });
add('add-folder', S, 'Add the photos from the folder {photos}/lisbon to this project.', ['view', P, 'photos.add'],
  { tab: 'select', not: ['open_project', 'post.assign'], expect: [{ op: 'photos.add', offered: true }],
    says: 'Adding files is the person\'s to confirm: it files the request and says they apply it in the app. It does not open the folder as another project.' });
add('by-contrast', 'marked', 'On every slide, pick the light or the dark version of my watermark, whichever reads better on the photo.', ['view', P, 'watermark.autoContrast'],
  { tab: 'watermark', not: ['set'], may: ['view_screenshot'], limits: { view_screenshot: 1 }, expect: [{ op: 'watermark.autoContrast', offered: true }] });

// --- posts ------------------------------------------------------------------------------------------------------------
add('rename-and-colour', S, "Rename the Stories post to 'Story highlights' and make its tab orange.", ['view', P, 'post.rename', 'post.color'],
  { not: ['post.create', 'post.delete'], expect: [{ op: 'post.rename', has: { name: 'Story highlights' } }, { op: 'post.color' }] });
add('posts-order', S, 'Put the Stories post before the Carousel.', ['view', P, 'post.reorder'],
  { not: ['order', 'post.moveSlide'], expect: [{ op: 'post.reorder' }] });
add('pinterest-instead', S, 'The carousel is going to Pinterest, not Instagram.', ['view', P, 'post.destination'],
  { not: ['post.create', 'post.rename'], expect: [{ op: 'post.destination', has: { destination: 'pinterest' } }] });
add('delete-post', S, 'Delete the Stories post.', ['view', P, 'post.delete'],
  { not: ['project.delete', 'post.unassign'], expect: [{ op: 'post.delete', offered: true }], says: 'Only the person removes a post: it files the request, says they confirm it in the app, and does not say the post is gone.' });
add('thumbnail', S, "Use the fishing boats photo as the project's thumbnail.", ['view', P, 'post.cover'],
  { not: ['order', 'post.assign'], expect: [{ op: 'post.cover', photos: ['fishing-boats.jpg'] }] });
add('out-of-stories', S, 'Take the fishing-boats photo out of Stories. It stays in the Carousel.', ['view', P, 'post.unassign'],
  { not: ['select.mark', 'post.delete', 'post.moveSlide'], expect: [{ op: 'post.unassign', photos: ['fishing-boats.jpg'], has: { post: 'post2' } }] });
add('mute-warning', S, 'Yes, village-street is in both posts on purpose. Stop warning me about it.', ['view', P, 'post.mute'],
  { not: ['post.unassign', 'select.mark'], expect: [{ op: 'post.mute', photos: ['village-street.jpg'], has: { on: true } }] });
add('copy-to-stories', S, 'Copy slide 9 into Stories too, exactly as it is.', ['view', P, 'post.moveSlide'],
  { not: ['post.assign', 'slide.duplicate'], expect: [{ op: 'post.moveSlide', slide: 9, has: { to: 'post2', copy: true } }] });
add('restore-version', S, 'Go back to the last version I saved of this project.', ['view'],
  { may: [P, 'project.restoreVersion', 'ask', 'choose'], not: ['history.jump', 'withdraw'], expect: [{ check: 'unchanged-but-questions' }],
    says: 'There is no saved version in this project: it looks (the versions list is empty), says so, and changes nothing. With one, the right operation is project.restoreVersion, which only asks the person.' });

// Changed after iteration 1, and why (EVAL.md): round-corner, detach-end and same-size asked for something the studio
// state could not give (the app refused, rightly), so they start from `lines`; circle-past-edge asked for what was
// already so and align-and-space for an arrangement that cannot fit, so they were reworded; template-on-stack named no
// one template and now names it. pick-six also accepts the picks filed as Select's field values (the Select skill's
// way) and a question after them; four-windows may fill its new window.

// Operations no task can reach from a person's words in a prepared state, and why (reported in EVAL.md):
const UNREACHED = {
  'rescued.reapply': 'needs an edit PicPrep kept after a failed save; a failed save cannot be staged without breaking the app under test',
  'rescued.discard': 'as rescued.reapply',
  'select.swapAlternate': 'needs frames with alternates, which Select finds itself among near-duplicates; the sample has none',
  'project.restoreVersion': 'needs a saved version, and only a window saves one; the near miss (no version to go back to) is the task restore-version',
};

// Near misses added to the tasks above: an operation that sounds like the request and is the wrong one for it.
const ALSO_NOT = { "white-gap": [ "post.color" ], "no-project-open": [ "post.reorder", "post.cover" ], "copy-to-stories": [ "post.reorder" ], "take-question-back": [ "post.cover" ], "out-of-stories": [ "post.mute" ], "bend-line": [ "layout.splitSeparator" ], "split-right-cell": [ "layout.splitSeparator" ], "remove-line": [ "layout.mergeSeparators" ], "quarter-turn": [ "layout.turnShape" ], "mirror": [ "layout.flipCut", "layout.turnShape" ], "line-across": [ "layout.diagonalCut" ], "one-cell-fewer": [ "layout.rotateQuadOrder" ], "swap-two": [ "layout.rotateQuadOrder", "slide.swapStack" ], "align-and-space": [ "layout.transformObjects" ], "same-size": [ "layout.transformObjects" ], "shrink-together": [ "layout.alignObjects", "layout.distributeObjects", "layout.matchSize" ], "reframe-four": [ "layout.stripGap" ]
};
for (const [name, items] of Object.entries(ALSO_NOT)) T.find(x => x.name === name).not.push(...items);

// Tasks reworded or restarted after iteration 1 (above): their iteration-1 runs answered a different request, so they
// are left out of iteration 1's numbers and run again, before and after the changes, in iteration 1b and 2.
const REPAIRED = ['round-corner', 'detach-end', 'same-size', 'circle-past-edge', 'align-and-space', 'template-on-stack'];

module.exports = { tasks: T, UNREACHED, REPAIRED, DEFAULT_MAY: ['view', 'list_projects', 'get_outcome', 'status', 'show_tab'] };
