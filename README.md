# The Vael Paper 📰

Your own daily newspaper — generated overnight, read like print.

![The front page and page two of a sample edition, shown as a two-page spread](docs/front-page.png)

*The opening spread of the sample edition, at the default text size. Nothing
here is a mockup: the column count is chosen from the measure, the drop caps are
sized from the font's own cap-height, and both stories break to "continued on"
slugs that resolve to real page numbers. Resize the window and it repaginates
around wherever you were reading.*

![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)
![Node 20+](https://img.shields.io/badge/node-20+-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)
[![CI](https://github.com/vaelkeep/vael-paper/actions/workflows/ci.yml/badge.svg)](https://github.com/vaelkeep/vael-paper/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-working%20prototype-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational)](LICENSE)

## ✨ Highlights

- **Real pagination, not scrolling.** Text flows into fixed pages that are
  recomputed for your screen and text size — with orphan and widow control,
  "continued on page 4" slugs, and tables that break between rows.
- **Typography that holds up.** Self-hosted Source Serif 4 and Playfair Display
  on a strict baseline grid, justified and hyphenated, with drop caps solved
  from the font's real metrics.
- **Never loses your place.** Rotate the iPad or change the text size and you
  stay on the same sentence, because the reader addresses articles rather than
  page numbers.
- **Fits phone, tablet and desktop.** The same edition becomes a two-page
  spread on a desktop, a single page on a tablet, and a continuous scroll on a
  phone — the layout is recomputed for the screen it lands on, not squeezed
  into breakpoints.
- **Easy on the eyes.** Warm off-white ground, sepia and night grounds, six text
  sizes, and photographs printed as ink rather than pasted on.
- **Nothing to break at 4am.** A malformed article or a missing image becomes a
  visible "printer's mark", never a blank page.

## 📑 Contents

- [Overview](#-overview)
- [Getting started](#-getting-started)
- [Usage](#-usage)
- [Publishing an edition](#-publishing-an-edition)
- [Configuration](#-configuration)
- [Architecture](#-architecture)
- [Security](#-security)
- [Development](#-development)
- [Roadmap](#-roadmap)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)
- [Author](#-author)

## 📖 Overview

Most personal news tools give you a feed. A feed is endless, and it never tells
you that you have finished. A newspaper does: it has a front page, an order, an
end, and it is the same for the whole day.

The Vael Paper is that, for one reader. A process generates an edition overnight
— summarising the news, your calendar, whatever you like — and in the morning
you read a finished object with pages you turn.

**This project renders and serves an edition. It deliberately does not generate
one.** Something else writes a finished edition into `editions/` in the format
described in [`docs/FORMAT.md`](docs/FORMAT.md), and the reader prints it. That
separation means the reader can be built and tuned against a hand-written sample
edition, and anything that can write markdown — a cron job, a shell script, you
with a text editor — can publish an issue.

## 🚀 Getting started

### Prerequisites

- **Python 3.11+** and [uv](https://docs.astral.sh/uv/)
- **Node 20+** and npm
- macOS or Linux (developed on macOS; nothing is platform-specific except the
  optional launchd job)

### Install and run

```bash
git clone https://github.com/vaelkeep/vael-paper.git
cd vael-paper

npm --prefix reader install
npm --prefix reader run build

cd server && uv run vael-paper
```

Open **http://localhost:8791** and you are reading the sample edition.

### Run it every day

On macOS, run it as a launchd agent. The plist is a template — launchd needs
absolute paths and will not expand `~` — so substitute them as you install it:

```bash
mkdir -p data/logs
sed -e "s|__VAEL_PAPER__|$PWD|g" -e "s|__UV__|$(command -v uv)|g" \
    launchd/com.coreautomation.vaelpaper.plist \
    > ~/Library/LaunchAgents/com.coreautomation.vaelpaper.plist

launchctl load ~/Library/LaunchAgents/com.coreautomation.vaelpaper.plist
```

The server binds `0.0.0.0`, so it is reachable from a tablet on the same
network, or over a private network such as Tailscale.

## 💡 Usage

| | |
|---|---|
| Turn a page | swipe, `←` / `→`, space, or `Home` / `End` |
| Text size | the `A`/`A` pair in the toolbar |
| Ground | Day / Sepia / Night |
| Jump to a story | **Contents** — sections and stories, with live page numbers |
| Earlier issues | **Archive** |
| Paged ↔ scrolling | the mode button, which overrides the automatic choice |
| Full screen | `⛶`, or press `f` |

On an iPad, **Add to Home Screen** runs it full-screen with no browser chrome.

### On every screen

There is one edition and no separate mobile version. The reader measures the
screen it is on and lays the same content out to suit it — the number of pages
shown, the number of columns, and whether it pages at all are all decided at
read time.

| Screen | Reads as | Columns | Line length |
|---|---|---|---|
| Phone, portrait | continuous scroll | 1 | ~41 characters |
| Tablet, portrait | a single page | 2 | ~43 characters |
| Tablet, landscape | a two-page spread | 1 per page | ~56–62 characters |
| Laptop / desktop | a two-page spread | 2 per page | ~39–43 characters |
| Ultrawide, full screen | a two-page spread | 3 per page | ~64 characters |

Phones scroll rather than page because at that width a "page" holds about
sixteen lines, which turns a short article into a dozen flips. That is a
default, not a rule — the mode button overrides it in either direction.

Rotating a tablet or changing the text size re-lays the whole edition and puts
you back on the sentence you were reading.

Links are canonical on the article, so they survive a change of device:

```
http://localhost:8791/#/2026-09-02/a/04-orbital-debris   ← stable
http://localhost:8791/#/2026-09-02/s/markets             ← jump to a section
http://localhost:8791/#/2026-09-02/p4                    ← resolved, then rewritten
```

> **The sample edition is fiction.** The stories, the market figures and the
> companies in `editions/2026-09-02/` were written to exercise the layout —
> long articles that force continuations, tables that must break across
> columns, a deliberately malformed file. None of it is reporting.

## 📰 Publishing an edition

Write a directory. The server picks it up on the next request — no restart, no
watcher.

```
editions/2026-09-03/
├── edition.json          # ordering and sections
├── articles/
│   └── 01-markets.md     # YAML frontmatter + markdown
└── images/
    └── chart.png
```

```markdown
---
headline: Markets Slip as Traders Weigh the Rate Path
deck: A cautious session ends lower
section: markets
byline: The Vael Desk
image: images/chart.png
sources:
  - name: Reuters
    url: https://www.reuters.com/markets/
---

The body starts here, in plain markdown. Pull quotes, lists, tables and
figures all become newspaper furniture.
```

Image dimensions, word counts and whether a picture is a photograph or a chart
are all worked out by the server — a generator is never asked for something it
cannot reliably know. **Full specification: [`docs/FORMAT.md`](docs/FORMAT.md).**

## ⚙️ Configuration

| Variable | Description | Default |
|---|---|---|
| `VAEL_PAPER_PORT` | Port for the API and reader | `8791` |
| `VAEL_PAPER_HOST` | Bind address | `0.0.0.0` |
| `VAEL_PAPER_EDITIONS` | Directory of editions | `./editions` |
| `VAEL_PAPER_READER` | Built reader bundle | `./reader/dist` |

The defaults sit clear of the ports commonly taken on a development machine —
`80`, `443`, `3000`, `5173`, `8000`, `8080` — so it can usually be started
without moving anything else. It uses **`8791`** for the API and **`5174`** for
its own dev server; set `VAEL_PAPER_PORT` if either clashes.

## 🏗️ Architecture

![Four stages: a nightly generator writes an edition directory, the FastAPI server scans it, and the TypeScript reader fetches it and measures, packs, renders and turns](docs/architecture.png)

```
vael-paper/
├── server/          FastAPI: scans editions, parses frontmatter, probes images
├── reader/          Vite + vanilla TypeScript reader
│   └── src/
│       ├── layout/  the pagination engine — measure, pack, plan
│       ├── render/  slice-and-clip rendering, page turns
│       ├── content/ markdown parser and edition validation
│       └── styles/  the broadsheet type system
├── editions/        editions on disk; a sample one is committed
├── docs/            format specification and engineering notes
└── launchd/         macOS agent definition
```

The server is deliberately dumb — it hands the client a bundle and does no
layout, because pagination depends on a viewport and font size only the client
knows. Everything interesting happens in `reader/src/layout/`, and is written up
in **[`docs/PAGINATION.md`](docs/PAGINATION.md)**.

The short version: each article is measured *once* into an offscreen ribbon, a
pure function packs columns using integer arithmetic over baselines, and a
fragment is rendered by cloning whole blocks and clipping them. Text is never
re-broken, only masked — which is why justification, hyphenation and drop caps
survive a page break intact.

## 🔒 Security

Article bodies are written by a language model from feeds nobody controls, so
untrusted input is the normal case rather than the exception:

- **Links are validated.** Only `http` and `https` URLs are ever linked;
  `javascript:`, `data:` and schemes smuggled past with control characters are
  refused, and the link degrades to plain text.
- **Content is escaped before any markup is generated,** and the markdown
  grammar accepts no raw HTML.
- **The server binds a local interface** and has no authentication. Put it on a
  private network or a tailnet — do not expose it to the internet.

## 🛠 Development

```bash
# reader — pagination engine, markdown parser, typography
cd reader
npm run dev        # :5174 with hot reload, proxying the API
npm test           # packer, geometry, markdown parser, drop-cap solver
npm run typecheck

# server — scanner and API
cd server
uv run vael-paper  # :8791
uv run pytest      # frontmatter tolerance, URL safety, the four endpoints
```

Both suites are pure and fast — no browser, no network, under two seconds
together. [CI](.github/workflows/ci.yml) runs them on every push, plus a job
that re-scans the sample edition, because it is both the test fixture and the
worked example in the format guide: if it stops scanning, the documentation is
wrong even when the code is right.

The engine's rules are not obvious from the code alone. **Read
[`docs/PAGINATION.md`](docs/PAGINATION.md) before changing anything under
`reader/src/layout/`** — it documents six invariants that, if broken, produce
symptoms that look like something else entirely.

## 🔮 Roadmap

- [ ] A nightly generator — a scheduled job that summarises feeds into an edition
- [ ] Front-page template matcher — named areas, a rail, teasers
- [ ] Package the four API endpoints as a plugin for a wider agent host
- [ ] Offline caching via a service worker
- [ ] Repeated column headers on a continued table

## 📜 License

[MIT](LICENSE) — do what you like with it, keep the copyright notice.

© 2026 Rod Moore

The MIT licence covers this project's own code. The fonts bundled under
`reader/src/fonts/` are third-party works redistributed under the SIL Open Font
License 1.1, which permits it — see [`NOTICE`](NOTICE).

## 🙏 Acknowledgements

- [Source Serif 4](https://github.com/adobe-fonts/source-serif) by Adobe and
  [Playfair Display](https://github.com/clauseggers/Playfair-Display) by Claus
  Eggers Sørensen — both SIL OFL 1.1
- [FastAPI](https://fastapi.tiangolo.com/), [uv](https://docs.astral.sh/uv/),
  [Vite](https://vite.dev/) and [Vitest](https://vitest.dev/)
- The pagination approach owes its shape to the failure modes of
  [paged.js](https://pagedjs.org/), which splits the DOM where this splits a
  ledger

## 👤 Author

**Rod Moore** — [@rmoore2112](https://github.com/rmoore2112)

Project: [github.com/vaelkeep/vael-paper](https://github.com/vaelkeep/vael-paper)
