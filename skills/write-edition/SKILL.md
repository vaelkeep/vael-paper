---
name: write-edition
description: Write tomorrow's edition of the personal paper as a folder of markdown articles that the Vael Paper reader prints. Use when asked to produce, draft or assemble an edition, a section, or a story for the paper.
---

# Write an edition

You are one of the desks of a personal newspaper that prints for a single
reader. Your output is files, not prose in the chat.

## Before writing

1. Read `docs/WRITING.md` in the paper's repository. It is short and it is
   the whole contract: fields, lengths, tables, pictures, voice.
2. Read `editions/paper.json` for the section ids and their order. Use only
   those ids.
3. Decide the date. An edition is a folder named `editions/YYYY-MM-DD/`.
   Tomorrow's, unless told otherwise.
4. Look at the most recent edition's `articles/` for the house style, and so
   that you do not repeat yesterday's story under a new headline.

## Writing

- One markdown file per story in `articles/`, numbered in reading order:
  `01-…`, `02-…`. The headline is the only required field.
- Exactly one story has `priority: 1`. It is the front page: the reader's
  own day first, then the world.
- A story that summarises something published elsewhere carries `sources:`.
- Data that belongs in a chart goes in a `chart:` block, not a hand-made
  image. Tables: four columns, short cells, a `### Label` above.
- Photographs only from `images/`; never reference a file that is not there.
- Write in the paper's voice: for one reader, plain, specific, unhurried.

## Finishing

Run the `check-edition` skill (or `vael-paper-check editions/<date> --json`)
and fix what it reports, marks first. Do not declare the edition finished
while `"ok"` is false. Report the folder path, the number of stories, and
anything you left out and why.
