# Having a model write your paper

The reader prints whatever is in a folder. This page is about filling the
folder every night with a language model — a modest one, running locally —
and about what to keep out of its hands so that it does not have to be a good
one.

## The shape of the job

A newspaper is not written by one person. It is assembled by desks, each with
a beat, a source of material, and a house style, and then put in order by an
editor who mostly leaves the order alone. That is the shape to copy, because
it is also the shape that lets a small model succeed: every desk is a short
prompt over a small amount of material, producing one file.

```
                     paper.json  (masthead, motto, section order — written once)
                          │
   calendar ─┐            ▼
   budget  ──┤  data desks ───► articles/17-the-week-ahead.md   (no model: a template)
   steps   ──┘                  articles/07-household-ledger.md
                                articles/10-the-week-in-steps.md
   feeds  ───┐
   notes  ───┤  prose desks ──► articles/02-orange-line.md      (a model, one desk at a time)
   photos ───┘                  articles/12-marmalade.md
                                          │
   everything above ─► the lead desk ───► articles/01-your-thursday.md   (the front page)
                                          │
                                          ▼
                                  vael-paper-check ──► fix ──► publish
```

Three kinds of desk:

- **Data desks** render structured data through a template. Appointments,
  the budget, the portfolio, steps, showtimes. No model is involved and no
  model should be: a table written from data by code is correct every
  night, and a table written from data by a model is correct most nights.
  Every one of the demo edition's tables could be produced this way.
- **Prose desks** give the model a beat and its material — the feeds for
  world and technology, the notes archive for "this week last year", the
  household — and ask for one story. Each desk has its own few rules in its
  prompt: length, whether it needs sources, its voice.
- **The lead desk** runs last, sees everything the others produced, and
  writes the front page: the reader's own day, in the order it will happen,
  tying the data to the stories. This is the one job that actually needs
  judgment, and it is where a stronger model earns its cost if you use one.

## What the format does so the model does not have to

The format was shaped by writing an edition by hand and noticing where a
model would stumble. Each of these is a thing the model *never does*:

| the model never | because |
|---|---|
| writes the manifest | `paper.json` holds masthead, motto and section order; articles name their section; the paper orders itself |
| keeps ids in sync | the filename is the id |
| numbers the issue | days since the paper was founded |
| supplies image sizes | the server measures them |
| draws a chart | it writes `chart: {values: [...]}` and the server draws the plate |
| quotes a colon in a headline | the scanner does it before YAML sees it |
| learns the field names | `title`, `author`, `photo`, `category` all mean what they say |
| guesses whether a table fits | `vael-paper-check` measures it against the column |

What is left is writing, which is what a language model is for.

## The loop

Every desk, and the edition as a whole, runs the same loop:

1. **Write** the file(s) into `editions/<tomorrow>/articles/`.
2. **Check**: `vael-paper-check editions/<tomorrow> --json`.
3. **Fix** each entry in `marks`, then each in `lint`, at the `file:line`
   the report names. The `check-edition` skill has the fix for every code.
4. Repeat until `"ok": true`. Stop at `"clean": true` when you can.

The paper never refuses to print, so a desk that gives up leaves a printer's
mark rather than a blank page. That is the right failure: visible at
breakfast, not fatal at four in the morning.

## With a coding agent and skills

Two skills in [`skills/`](../skills/) package the guide and the loop for an
agent that can read files and run commands (Claude Code, or anything that
takes a `SKILL.md`):

- **`write-edition`** — reads `docs/WRITING.md` and `paper.json`, writes the
  folder, runs the check, and does not stop while `"ok"` is false.
- **`check-edition`** — runs the check and fixes by code.

A nightly job is then a prompt: *"Write tomorrow's edition. The calendar,
budget and steps exports are in `inbox/`, the day's feed summaries are in
`inbox/feeds.md`, this week's notes are in `inbox/notes.md`, and the photos
you may use are in `inbox/photos/`. Use the write-edition skill."* Give the
agent the desks as a list and it will work through them; give it the loop and
it will finish clean.

For a plain model with no tools — an Ollama endpoint and a script — the same
division holds. The script is the editor: it runs the data desks itself,
calls the model once per prose desk with `WRITING.md` as the system prompt and
the desk's material as the user turn, writes what comes back to a file, runs
the check, and feeds the report back for one more turn. Small models do well
with one story at a time and a guide they can hold in context; they do badly
with "write a newspaper".

## What to feed it

- **Feeds**, already summarised to a paragraph each, with the URL. The world,
  technology and local desks want a handful of these, not the firehose. The
  model's job is to pick and write, not to read four hundred items.
- **Your own data**, as JSON or CSV in a folder the data desks read: the
  week's calendar, the month's spending against plan, the portfolio at the
  close, steps, whatever you track. This is what makes it your paper.
- **Your notes**, for the desk that surfaces something you wrote a year ago,
  or a reminder you set and forgot.
- **A photo library** the household desk may draw on, referenced by filename.
  A model cannot make a picture; it can choose one.
- **Yesterday's edition**, so it does not tell you the same thing twice.

## Scheduling

The server watches nothing and needs no restart; it reads the folder on each
request. So the job is simply: at 04:00, assemble tomorrow's material, run the
desks, check, and write the folder. On macOS a `launchd` plist for the writer
sits beside the one for the server; on Linux, cron. The static export
(`vael-paper-export`) does the same for a paper published as files.

## What not to automate

- **The paper's identity.** `paper.json` is yours. Change the section order
  by hand when you want a different paper, not because a model suggested it.
- **The data desks.** A template that prints your budget is thirty lines of
  code and is right forever. Resist the urge to have a model "improve" it.
- **Publishing on red.** A job that publishes an edition with marks is a job
  that will one day publish an empty one. Fail the run, keep yesterday's
  paper, and read the report in the morning.

## A first nightly job, in order

1. Write `editions/paper.json`: your masthead, your sections, the date you
   started.
2. Export one real data source to `inbox/` and write the data desk for it.
   You now have a paper with one true table in it.
3. Add one prose desk over one feed. Read the result for a week; tune the
   desk's prompt, not the model.
4. Add the lead desk last, once there is something for it to tie together.
5. Put `vael-paper-check --strict` between the desks and the publish step,
   and only then schedule it.
