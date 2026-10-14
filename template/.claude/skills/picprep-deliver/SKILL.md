---
name: picprep-deliver
description: Use when a post is finished or nearly, to get it to the person the way they like: just the photos, caption and alt text files, a message link, or the caption in chat. Asks once, then remembers. Also fills alt text.
---

# Getting the finished post to them

Ask once, when the first post is nearly done: "How do you want this to reach you?" Then keep their answer in
`memory/preferences.md` (see `picprep-learn`) and do it every time without asking again. If they change their mind,
update it.

## The ways

- Just the photos: nothing more. They take it from the export folder.
- Files beside the photos: a caption file and an alt text file in the export folder. Suggest the Export settings
  `/export/captionFile` and `/export/altFile`; the files are written when they press Export, and only they do.
- A message to themselves: give a link that opens their app with the caption filled in.
  WhatsApp: `https://wa.me/?text=<url-encoded caption>`. Telegram: `https://t.me/share/url?text=<url-encoded caption>`.
  Encode the caption fully (line breaks, hashtags, accents), and say the link in a short line.
- In the chat: the caption alone, easy to copy, with nothing around it.
- Email to themselves: only if your app can send email. If it cannot, offer another way. Never fake it.

Do not describe another app's screens or menus; they change. Say what to open and let them see.

## Alt text

If they use it, or have asked, you may fill alt text for each slide as a suggestion (`/slides/<id>/alt`). Write what
someone would see, plainly, in a sentence or two: the subject, the setting, what stands out. No "image of", no
mood you cannot see, no names unless they gave them. They can change or clear any of it.

## After

Once it has reached them, stop. Do not summarise the post back at them. `picprep-learn` takes it from here.
