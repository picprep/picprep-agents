---
name: picprep-onboard
description: Use on the person's first session with this assistant, or when they ask to set it up again, to get to know them through their first real post. Asks at most three questions, starts their platform's data export, finishes a post, and writes what it learned into memory.
---

# Getting to know the person by doing their first post

The goal is not a profile. It is a finished post they would publish, and a memory that makes the next one easier.
Talk like a friend; keep every message short.

## Before the first real work: at most three questions

Ask them one at a time, only what you cannot already see or learn from the work. If they already gave an answer
(for example by pasting a summary from another AI, or in their first message), start from it and skip the question.

1. What do you post, and where? (accounts, platforms, languages)
2. Which parts do you want help with? (picking photos, order, framing, marks, export, captions, getting it to
   your phone)
3. Optional: is there anything I should look at, or steer clear of? Ask them to label each one: "like this",
   "avoid this" or "just context". An "avoid this" is remembered only as something to avoid, never imitated.

If they have a request already ("I want to post these"), that is the first real work. Do not hold it back for the
questions; ask them as they come up.

## Learn from their own posts

If they give screenshots or an export of their recent posts, read them: caption length and language, emoji and
tag habits, how many photos a post has, whether they use a mark, how often they post. Note what you see as
"seen in their posts", with the date. Do not copy another account's habits into their preferences.

## Start the data export early

It takes the platform time to prepare, so offer to start it near the beginning, as a favour, not a requirement:
"This takes a while to prepare, want to start it now?"

- Meta (Instagram, Facebook): "Download your information". X: "Download an archive of your data".
- Do not give the steps from memory. Open the platform's current help page, follow it, and give the person the
  steps as the page now states them. Menus move. If you could not open or confirm a step, say that you could not,
  and do not present it as fact.
- Name the choices that matter: the full time range (all time), the JSON format, and at least posts, likes,
  saved and comments.
- Tell them where the file goes when it arrives: the `memory/sources/` folder in this workspace, and
  `picprep-feed` takes it from there.
- If they say not now, work with defaults and learn anyway. Offer once more at a natural pause, then leave it.

## Do the real post

Run their post through the stage skills and their workflow. Where you are least sure, offer two to four
alternatives rendered in PicPrep with the `choose` tool (two covers, two caption drafts, two mark corners),
never as words in the chat. Follow `picprep-caption` for the caption. Finish the post as far as their workflow
goes.

At the end, say in passing what you picked up, as a friend would: "You never use hashtags, so I left them off."
Not as a report.

## Write down what you learned

- `memory/about.md`: who they are and what they post, where, in which languages, which parts they want help with.
- `memory/preferences.md`: how they like things, grouped by stage (select, order, frame, mark, export, caption).
- References go in `memory/references.md`, each with its label.
- Every item says where it came from (what they said, which posts, what they did in PicPrep) and the date.
- A one-off ("not this time") is not a preference. Stay within each file's limit stated in its first comment.
- Never write a password, token or credential. Write handles only in backticks.

Then continue as normal; `picprep-learn` takes over after each post.
