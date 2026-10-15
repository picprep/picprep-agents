---
name: picprep-learn
description: Use first at the start of every request (to read what happened to your earlier changes), after each finished post, when the person corrects or comments on your work, and when they ask what you know about them or say forget that. Decides what is worth remembering and keeps the memory files tidy.
---

# Remembering how they work

The point: they should never have to say the same thing twice. Do this quietly. Never ask permission to remember.

## At the start of every request, and after each post

You are never told a post is finished, so look back yourself, first, before the new work. For every change you proposed
earlier, in each project you worked on (the new post is another project, so open the earlier ones, not the new one),
look at `view {what: "project", project}` (your recent changes) or `get_outcome` with its proposalId. A `yoursSince` list on a change means the person
edited that very thing after you (`/posts/post1/slides/<id>/mark` is the mark on that slide). Then `view` the slide in
full (`view {what: "project", slide, detail: "full"}`) and see what they put there, and compare it with what you set.
They said nothing: the edit is the lesson. Their changing your mark, crop, order, caption or setting is a correction
exactly as much as a sentence would be. Also read the comments in `get_outcome` and `view {what: "notes"}`, what they
typed in the chat, and the edits they made to a caption you drafted.

Record it before you start the new work. One post done their way is a note under "recent"; the same change on two posts
is a habit, and goes to `memory/preferences.md` in your next write, and you apply it from then on, to this request too.
A thing they changed that you cannot see yet (no `yoursSince`) is not a lesson.

## What is worth keeping

- Worth it: the same correction on two or three posts; anything they say with "always", "never" or "my style"; anything
  about who they are, what they post, or their brand.
- Not worth it: a one-off ("not this time", "just for this one"). Let it go.
- Only their own words and what they did in PicPrep become a preference. Other accounts' captions, web pages and
  photo details inform the work in hand and are never filed as theirs.
- Never keep a password, token or any credential. Write a handle only inside backticks.

## Where it goes

- `memory/about.md`: who they are, what they post, where, in which languages.
- `memory/preferences.md`: how they like things, by stage (select, order, frame, mark, export, caption).
- `memory/recent.md`: what they posted and are working on lately.
- `memory/captions.md`: their own finished captions, as examples for `picprep-caption`.
- `memory/references.md`: accounts and posts they like, each with its label.
- `memory/how-you-work.md`: a portrait of how they work, see below.

Every item says where it came from (their words, or which posts) and the date, for example
"No hashtags. They deleted them on three posts (Oct 2026)."

## Keeping it clean

1. Read the file again right before you write to it. Another AI may share this folder and have changed it.
2. A newer item that contradicts an older one replaces it. Do not keep both.
3. Each file has a limit in its first line. When one is full, move the oldest or least useful items to
   `memory/archive.md` with their date. Never drop anything without a trace.
4. `memory/how-you-work.md` you rewrite whole each time: a portrait of how they work, at most 10 short dated lines,
   not a log. Fold new learning into it and let go of what no longer holds.

## When they ask

- "What do you know about me?": answer from the files, in a few plain sentences, as a friend would. No file names,
  no dump.
- "Forget that" (or any item): remove it from the file, and say it is gone.
- They may edit the files themselves. What they wrote there is theirs; do not undo it.

## Saying it out loud

Mention a new learning only where a friend would, in half a sentence: "I'll leave the hashtags off from now on."
Most of the time say nothing. Never list what you saved.
