# Evaluating PicPrep's assistant tools

How well do fresh assistants, knowing nothing but what PicPrep tells them, use its tools? This page reports one
evaluation (2026-10-05), what it found, and what was changed because of it. **The changes are not yet re-measured**:
the second round was stopped before it started (see "Cost and size").

## Method

After the skill-creator plugin's evaluation method: prompts a person would type, run by fresh assistants with and
without the skills, each transcript graded on its own by a fresh grader, the numbers gathered, then improve.

- **Starting states**: the app from source, a throwaway user folder per run (a copy of the bundled sample photos),
  its window started `--unseen`. States are built with the app's own server and tools (`eval/lib/fixtures.js`): a
  fresh project, a finished carousel, a "studio" with one slide of every kind and two posts, an earlier assistant
  session with reasons on file, two projects, an open question, the sample watermark on every slide.
- **Assistants**: headless Claude Code (`claude -p`, Sonnet, at most 30 turns, a run cut at 4 minutes) in an empty
  folder with no CLAUDE.md, no user settings and no other MCP server. **Arm A (connector)**: the connector is the
  only tool: all the assistant knows is the app's instructions, tool descriptions and schemas. **Arm B (plugin)**:
  the same plus the five skills, loaded as the plugin loads them. No other assistant CLI was installed, so arm A
  ran on Claude Code only.
- **Tasks**: 99, each in a person's words and naming no tool (`eval/tasks.js`, written out as `eval/evals.json`).
  Every one of the 11 tools and 91 operations is the right answer to some task and a tempting wrong one in another
  (`node eval/eval.js labels` checks this). Four operations no task can reach: `rescued.reapply`,
  `rescued.discard` (need an edit kept after a failed save), `select.swapAlternate` (needs frames with alternates;
  the sample has none), `project.restoreVersion` (needs a version only a window saves; the near miss is the task
  `restore-version`). Traps: PicPrep not running, no project open, no licence, an ambiguous request, deleting the
  project, exporting.
- **Labels, written before any run**: for each task the tools and operations it must use, may use and must not use,
  and what must be true of the project afterwards.
- **Scores**: `eval/lib/score.js`, mechanically, from the calls and the project on disk before and after: recall and
  precision against the labels, forbidden and needless calls, limits, order (looked before changing; status around
  the changes), and the expectations on the project. Then a fresh grader per transcript (`eval/grader.md`), given the
  project before and after: outcome, truthful, reasons, hand-over, recovery, person-only, economy.
- **Runs**: 3 per task per arm.

### What was changed in the method after the fact

- `pick-six` also accepts the picks filed as Select's field values (the Select skill's way) and a question after
  them; `four-windows` may fill its new window. Both labels were too strict.
- **Left out of the numbers** (36 runs): two ill-posed tasks, `round-corner` and `detach-end`, asked for what the
  studio slide could not give (the app refused, rightly, and the assistants said why). Four more asked for what was
  already so or could not fit (`circle-past-edge`, `same-size`, `align-and-space`) or named no one template
  (`template-on-stack`). All six are rewritten in `eval/tasks.js` for next time; the first three start from a new
  state, `lines`.
- "Connection closed" from `get_outcome` (5 runs) was **this harness's 4-minute cut-off**, not the app: every such
  run was one the harness ended while the assistant waited up to 300 s for an answer nobody was there to give.
- A screenshot after a layout change counts against "clean" as labelled; `clean_one_look` allows one.

### Recommended size next time

**Far smaller.** 99 tasks × 2 arms × 3 runs plus a grader for each was far more than the questions needed (see
"Cost and size"). Twelve tasks cover what moved the numbers here: `pick-six`, `left-out-why`, `export-it`,
`undo-that`, `not-running`, `viewing-only`, `favourite`, `delete-project`, `watermark-all`, `cramped`,
`x-as-well`, `sixty-forty`. Run them 2 or 3 times per arm, and grade a sample by hand. The per-operation tasks only
show that the operation list is learnable (it is, see below); rerun them when an operation's wording changes.

## Results (iteration 1, before any change)

273 runs connector only, 272 with skills (the six tasks above left out).

| measure | connector only | with skills |
|---|---|---|
| goal reached in the app (script) | 97% | 98% |
| outcome (grader) | 94% | 97% |
| recall of required tools and operations | 99% | 99% |
| precision | 95% | 95% |
| clean: nothing missed, forbidden, needless or over a limit | 72% | 71% |
| clean, one look at the result allowed | 92% | 88% |
| used a forbidden tool | 1% | 1% |
| looked before changing | 100% | 100% |
| `status` around the changes where it was due | 0% | 50% |
| truthful closing message (grader) | 54% | 55% |
| reasons that say why, not what (grader) | 72% | 78% |
| told the person it is theirs to keep or reject (grader) | 70% | 81% |
| recovered from a refusal (grader) | 93% | 93% |
| never presented a person-only act as its own (grader) | 99% | 100% |
| economy (grader) | 72% | 72% |
| calls per run | 5.7 | 5.9 |
| seconds per run | 37 | 35 |

### Per tool and operation

`should`: the runs where it was right (an "any of" requirement is split between its alternatives). `used`: how
often it was used then, arm A / arm B. 63 of the 80 operations used were chosen right in every run; the rest:

| tool or operation | should | used (A / B) | used wrongly (A / B) | used needlessly (A / B) | picked instead when missed |
|---|---|---|---|---|---|
| list_projects | 4 | 6 / 6 | 0 / 0 | 0 / 0 | |
| open_project | 4 | 3 / 3 | 0 / 0 | 0 / 0 | |
| view | 245.5 | 246 / 243.5 | 0 / 0 | 0 / 0 | |
| view_screenshot | 6 | 6 / 6 | 0 / 0 | 68 / 66 | |
| show_tab | 3 | 3 / 3 | 0 / 0 | 0 / 0 | |
| ask | 5.5 | 3 / 2 | 2 / 0 | 0 / 0 | B: choose |
| choose | 5.5 | 8 / 6 | 0 / 1 | 3 / 3 | |
| propose | 229 | 228 / 228 | 0 / 0 | 0 / 0 | A: ask |
| get_outcome | 1.5 | 0 / 0.5 | 0 / 0 | 0 / 0 | |
| withdraw | 6 | 6 / 6 | 0 / 0 | 0 / 0 | |
| **status** | 6 | **1 / 3** | 0 / 0 | 0 / 0 | A: ask, nothing |
| order (propose `slides`) | 6 | 6 / 6 | 0 / 0 | 1 / 1 | |
| set (field values) | 4.5 | 2 / 6 | 0 / 0 | 0 / 1 | A: ask |
| layout.applyTemplate / slide.applyTemplate | 1.5 each | 2 / 0, 0 / 2 | 0 / 0 | 0 / 0 | layout.moveSeam |
| layout.moveSeam | 3 | 3 / 3 | 1 / 1 | 0 / 0 | |
| layout.moveSeparatorEnd | 3 | 3 / 3 | 0 / 1 | 0 / 0 | |
| layout.placeSeparator | 3 | 3 / 3 | 0 / 0 | 0 / 1 | |

Other operations short of `should` were "any of" alternatives where the other one was picked (`slide.setType` vs
`slide.blurFit`, `slide.unsplit`, `slide.split`; `slide.toolNew` vs `slide.addTemplate`; `slide.newSlide` vs
`slide.addTemplate`; `slide.pasteLookNew` vs `slide.copyLayout`; `layout.transformObjects` vs
`layout.moveShape`/`resizeShape`; `post.assign` vs Select's field values): not confusions.

### Per task (goal reached / tools chosen cleanly, of 3 runs)

Only the tasks with something to see; the "clean" misses here are almost all a screenshot after the change.

| task | connector only | with skills |
|---|---|---|
| pick-six | 3/3 · 0/3 | 3/3 · 0/3 |
| x-as-well | 1/3 · 2/3 | 2/3 · 2/3 |
| watermark-all | 0/3 · 0/3 | 3/3 · 0/3 |
| cramped | 3/3 · 2/3 | 3/3 · 0/3 |
| ask-mood | 3/3 · 3/3 | 2/3 · 2/3 |
| sixty-forty | 2/3 · 0/3 | 2/3 · 2/3 |
| wider-boats, split-right-cell, quarter-turn, landscape, one-cell-fewer, line-across, triangle, reset-lines, remove-line, bend-line, sharp-and-fewer, slide-end, move-line, place-line, move-junction, cut-and-join, add-box, circle-cuts, circle-up-bigger, window-to-front, copy-window, shrink-together, four-windows, gentle-slant, rotate-quad, white-gap, make-panorama, panorama-in-two, blur-fit, reframe-four, card-in-place, new-from-tool, photo-into-circle, pinterest-instead | 3/3 goal; clean 0-3/3 | 3/3 goal; clean 0-3/3 |

Clean in all six runs: `left-out-why` (by the script; the grader failed most on truthfulness, below), `export-it`,
`undo-that`, `not-running`, `no-project-open`, `viewing-only`, `favourite`, `delete-project`, `circle-covers`,
`count-slides`, `take-me-to-export`, `open-lisbon`, `which-projects`, `choose-closer`, `take-question-back`,
`did-i-answer`, `swap-two`, `mirror`, `straighten-curve`, `lock-curve`, `drop-bend`, `remove-circle`, `tilt-window`,
`group-all`, `ungroup`, `stack-two`, `unstack`, `pull-one`, and the remaining slide, picking and post tasks.

## What went wrong, with excerpts

1. **`status` skipped.** Due in 6 runs per arm; arm A used it once, arm B three times. The tool said "a task of
   several steps"; nothing in a short task matched that.
2. **Closing messages claim what was never read** (grader: 124 of 267 runs A, 119 of 265 B). The usual form is a
   true report padded with an unread detail:
   - `swap-two`: "Each photo keeps its own framing." (never read)
   - `group-all`: "Clicking one window now selects all three, and they move together." (never tried)
   - `four-windows`: "I checked a render of the slide and it exports without errors." (the render was refused)
   - `pinterest-instead`: "18 of 5 slides ... 13 would not be posted" (no answer said so)
3. **The reason restates the request** (61 of 220 runs A, 49 of 223 B): `duplicate` "Duplicate slide 7 as asked";
   `mark-some` "Cut mount-ida"; `remove-circle` "Remove the circle from slide 9". The tool's own example taught it:
   `"why":"side by side"`.
4. **No hand-over** (68 of 225 runs A, 44 of 226 B): "The change is applied." and nothing about keeping or rejecting
   it. The skills say it; the tool texts did not.
5. **"Why did you leave these out?" answered "no reason was recorded"** (`left-out-why`, 3 of 3 A, 1 of 3 B): "Four
   of the 10 photos in Trip aren't in Post 1. I can't tell you why I left them out, because I didn't record a
   reason." The reasons were on file; `view` did not return a change's `why`.
6. **A watermark could not be set without the skill** (`watermark-all`, 0 of 3 A): it guessed targets
   (`/slides/<id>/mark/on`, `/watermark/mark/on`, `/mark/on`), each refused "parent does not exist", then said "no
   operation" exists. Nothing named the target or the mark ids; with the skill, 3 of 3.
7. **Template ids refused**: `view what:"templates"` lists `col-6040`; `layout.applyTemplate` answered "no template
   "col-6040"; there are [... "side6040:default" ...]".
8. **Waiting on nobody**: after asking, assistants called `get_outcome` with `waitSec` 120 to 300 in an empty room.
9. **Screenshots**: 68 / 66 needless, nearly all one look after a layout change; `clean_one_look` is 92% / 88%.

What held up: the right operation was picked almost every time, from the operation list alone (recall 99%,
forbidden 1%); every trap (not running, no licence, delete, export, no project open, an ambiguous request) was
handled in both arms; nothing person-only was presented as done.

**What the skills fixed that the tools should carry** (connector-only is what most assistants get): status (0% to
50%), the hand-over (70% to 81%), the watermark recipe (0 of 3 to 3 of 3), and the reasons a little (72% to 78%).
The skills did not fix the false claims (54% vs 55%).

## What was changed

In the app (`picprep`, branch `001-unified-toolset`, commit `cf15581`):

- **Server instructions**: `status` before the first change of any task; a `why` says why it suits these photos, not
  what the operation does; the closing words say what changed, that it is theirs to keep or reject, and only what
  the tools answered; how a watermark is set; no long wait on a question nobody may be there to answer; a refusal
  that a thing is already so is the answer; one look after a visual change, not one per step.
- **Tool texts**: `status` "working true before the first change of a task"; `ask` "what only they can judge,
  rather than guess"; `get_outcome` waits "when they answer now"; `propose`'s `why` "why it suits these photos or
  this slide, shown beside the change", and its example no longer "side by side". The ten tools stay within their
  11,200 characters, `status` within 650.
- **Behaviour**: `view what:"notes"` and the project summary give each change's `why`; `view what:"presets"` lists
  the person's watermarks by id (`marks`); `layout.applyTemplate` takes the library's collage ids (`col-6040`) with
  their look, at the cause (the template argument resolves a library id).
- Pinned in `test/mcp.js` and `test/unit/slideops.js`; contracts `specs/004-assistant-acts/contracts/mcp-tools.md`
  and `specs/001-unified-toolset/contracts/mcp-tools.md` updated.
- **Skills** (both repos): `status` before the first change; a paragraph on the hand-over, reasons, saying only what
  happened and not waiting on nobody; the watermark skill says where the mark ids are.

Here: the skills copied from the app, the README's tool table, `test/parity.js` following the app's `show_tab`
wording, and the eval itself (`eval/`).

Not changed, and why: `get_outcome`'s "Connection closed" was this harness's cut-off (above), not the app.

## Not yet measured

None of the changes above has been run against assistants. The twelve tasks above, both arms, before (`2cddd8a` of
the app) and after (`cf15581`), would measure them; that needs the maintainer's go-ahead.

## Cost and size

589 assistant runs (8 trial, 581 in iteration 1) and 577 grader runs, all `claude -p` on the account signed in to
Claude Code on this computer (no API key was set). The runs reported $56.22 for the assistants and $23.04 for the
graders. The maintainer stopped the evaluation before the second round: it was far larger than the questions
needed. Use the twelve-task set.

## Running it

```sh
node eval/eval.js labels                 # check the labels cover every tool and operation
node eval/eval.js fixtures               # build the starting states (EVAL_WORK, outside this repo)
node eval/eval.js run --iteration 2 --tasks <names> --runs 2    # starts assistants: ask first, it costs
node eval/eval.js grade --iteration 2    # starts graders: ask first, it costs
node eval/eval.js rescore --iteration 2  # the mechanical scores again, no model
node eval/eval.js report --iteration 2 --previous 1
```

The runner shares the machine: at most two apps at once, a batch only while the load is under 3, the window lock
`/tmp/pp-flow.lock` held about five minutes at a time and then left for anyone waiting, and released (with every app
and assistant stopped) on any exit.

## Personal assistant (2026-10-15, Claude Code only)

**What ran.** Spec 010 FR-110 / T037, on Claude Code only (no Codex, no Gemini: no subscription). Four scripted people,
two runs each, 8 conversations (`node eval/assistant/eval.js --runs 2`; `--dry` checks everything without calling
Claude). Each run: a throwaway user folder, five projects of three sample photos, an assistant folder made by the app's
own route (`POST /api/assistants`) from the template, the app from source with its window unseen, and one Sonnet session
per run continued with `--resume` (cwd = the assistant folder, the connector the only MCP server, the skills from the
folder itself). Scored from the files and the app's projects, with regexes; no grader model. 8 runs, 22 minutes, $7.53 on
the signed-in account; none was cut off (limit 8 minutes). Everything it made was deleted.

| Persona | Result | Evidence |
|---|---|---|
| repeat-correction (SC-003) | not measured | Posts A to D were marked bottom right on the first try in both runs, so no correction was ever made. 1 of 2 runs wrote the corner to `preferences.md` with source and date anyway (the person had said it once); the other wrote nothing about it. |
| onboarding (in the above) | pass 2 of 2 | 1 and 0 questions before the first change; `about.md` written both times. |
| one-off (SC-003, second half) | pass 2 of 2 | "Not this time" took the marks off Post A; no line about it in memory; Post B marked as usual. |
| caption-voice (SC-005, mechanical) | pass 2 of 2 | 5 of 5 captions filed in Export; no tells from the caption skill's list, no hashtags, all lowercase, 35 to 60 characters against a median of 32 in the seeded set (limit 64). |
| compaction (SC-004) | 1 of 2 | `/compact` works as a turn of `claude -p --resume` and reported success. Run 1 applied all three seeded preferences after it. Run 2 applied the mark and the caption but filed no export setting for the location. Target is 100%. |

**Could not be measured.** Other vendors (SC-006). SC-001 (a person's time). SC-005's blind judgement and invented facts
(one caption named "quebec city" from a file name; whether that is a fact on the photo was not judged). SC-003's first half:
the template's default corner is the one the persona asks for, so a repeated correction never happened; it needs a persona
who wants the top left. "List of three" is not scored (it also appears in the person's own seed captions).

**What the results suggest changing in the template (not done here).**
1. `picprep-export` (and `AGENTS.md`): say that export choices in `memory/preferences.md` (location, preset, names) are
   filed as suggestions at the start of the export step, like the mark and the caption; run 2 skipped the location one.
2. `AGENTS.md` "How you talk": the first replies announce their reasoning ("First session, so onboarding applies",
   "Empty memory, so..."). Say that the person is not told which skill or rule is being followed.
3. The stage skills or app instructions make every reply end with "it stands unless you reject it"; once per session is
   enough. (That text is the app's tool instructions, so the change is in the app.)
4. Next time: a persona who asks for a corner the template does not choose, so SC-003 is exercised, and 3 runs of
   compaction, since 1 of 2 is too few to tell 100% from 50%.
