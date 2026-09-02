/**
 * A deliberately narrow markdown parser: paragraphs, h2/h3, emphasis, lists,
 * blockquotes (which become pull quotes), rules and inline images.
 *
 * Narrow on purpose. Every construct we accept is a construct the paginator
 * must be able to measure and break correctly, so the grammar is a liability
 * rather than a feature. No raw HTML, no tables — the input is escaped before
 * any markup is generated, so a generated edition can never inject markup.
 */

import type { Align, Block } from '../model/types';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
}

/** Typographic niceties that must happen before line measurement. */
function smarten(text: string): string {
  return text
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2') // number ranges take an en dash
    .replace(/\s--\s/g, ' — ') // em dash, hair-spaced
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s(\[])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[])'/g, '$1‘')
    .replace(/'/g, '’');
}

/**
 * Only these schemes may reach an href.
 *
 * The body of this paper is written by a language model from feeds nobody
 * controls, so `[click here](javascript:...)` is a realistic input rather than
 * a hypothetical one. Anything else keeps its text and loses its link.
 */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  // Control characters or whitespace inside a URL are how a scheme gets
  // smuggled past a naive test; refuse rather than try to sanitise.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020"'<>`]/.test(url)) return null;
  // By the time this runs the text has already been HTML-escaped, so a quote
  // or an angle bracket arrives as an entity. `&amp;` is legitimate — a query
  // string — but an escaped quote or bracket can only have come from an
  // attempt to break out of the attribute.
  if (/&(quot|apos|lt|gt|#)/i.test(url)) return null;
  return url;
}

/**
 * Inline markup. Runs after escaping, so the only angle brackets present are
 * the ones we introduce ourselves.
 */
function inline(text: string): string {
  let out = smarten(escapeHtml(text));
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const url = safeHref(href);
    // An unsafe or malformed link degrades to its own text — never to a
    // clickable thing that does something else.
    return url
      ? `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`
      : label;
  });
  return out;
}

/** Split on blank lines, keeping list runs and quote runs together. */
function chunk(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * A GitHub-style pipe table.
 *
 * Recognised by its delimiter row (`|---|---:|`), which also carries the column
 * alignment. Financial copy is the reason this exists at all: a market report
 * without tables is not a market report.
 */
function parseTable(raw: string): Block | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // One dash is enough: `:-:` and `|-|-|` are both common in the wild, and the
  // whole line must consist only of dashes, colons and pipes, so a looser
  // repeat does not make a false match on prose any more likely.
  const DELIM = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
  const delimAt = lines.findIndex((l) => DELIM.test(l));
  // The delimiter must be the second line — otherwise this is prose that
  // happens to contain a pipe.
  if (delimAt !== 1) return null;

  const cells = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());

  const head = cells(lines[0]!);
  const align: Align[] = cells(lines[1]!).map((spec) => {
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  const rows = lines.slice(2).map(cells);
  if (rows.length === 0) return null;

  // Ragged rows are padded rather than rejected: a generator dropping a cell
  // should cost that cell, not the table.
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  };

  return {
    kind: 'table',
    head: head.some(Boolean) ? pad(head).map(inline) : [],
    rows: rows.map((r) => pad(r).map(inline)),
    align: Array.from({ length: width }, (_, i) => align[i] ?? 'left'),
  };
}

export function parseMarkdown(body: string): Block[] {
  const blocks: Block[] = [];
  let sawFirstPara = false;

  for (const raw of chunk(body)) {
    // ---- rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw)) {
      blocks.push({ kind: 'rule' });
      continue;
    }

    // ---- heading
    const heading = /^(#{2,3})\s+(.*)$/.exec(raw);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length === 2 ? 2 : 3,
        html: inline(heading[2]!),
      });
      continue;
    }

    // ---- table
    if (raw.includes('|')) {
      const table = parseTable(raw);
      if (table) {
        // A label immediately above a table is set as its heading rather than
        // as a crosshead, so the two stay together on a page.
        const previous = blocks[blocks.length - 1];
        if (previous?.kind === 'heading' && previous.level === 3) {
          blocks.pop();
          (table as Extract<Block, { kind: 'table' }>).label = previous.html;
        }
        blocks.push(table);
        continue;
      }
    }

    // ---- standalone image  ![caption](images/x.png)
    const figure = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(raw);
    if (figure) {
      const block: Block = {
        kind: 'figure',
        imageKey: figure[2]!.replace(/^\.\//, ''),
        scope: 'col',
      };
      if (figure[1]) block.caption = figure[1];
      blocks.push(block);
      continue;
    }

    // ---- blockquote becomes a pull quote, anchored to the preceding block
    if (raw.split('\n').every((l) => l.startsWith('>'))) {
      const lines = raw.split('\n').map((l) => l.replace(/^>\s?/, ''));
      let attribution: string | undefined;
      const last = lines[lines.length - 1] ?? '';
      if (/^[—-]{1,2}\s*\S/.test(last)) {
        attribution = lines.pop()!.replace(/^[—-]{1,2}\s*/, '');
      }
      const block: Block = {
        kind: 'pullquote',
        html: inline(lines.join(' ')),
        anchorBlock: Math.max(0, blocks.length - 1),
      };
      if (attribution) block.attribution = inline(attribution);
      blocks.push(block);
      continue;
    }

    // ---- list. Items may wrap onto continuation lines, which is how any
    // sane writer (or generator) hard-wraps prose, so only the *first* line of
    // an item carries the marker and the rest fold back into it.
    const lines = raw.split('\n');
    const BULLET = /^\s*[-*]\s+/;
    const NUMBER = /^\s*\d+[.)]\s+/;
    if (BULLET.test(lines[0]!) || NUMBER.test(lines[0]!)) {
      const numbered = NUMBER.test(lines[0]!);
      const marker = numbered ? NUMBER : BULLET;
      const items: string[] = [];
      let wellFormed = true;
      for (const line of lines) {
        if (marker.test(line)) {
          items.push(line.replace(marker, ''));
        } else if (items.length > 0 && line.trim()) {
          items[items.length - 1] += ` ${line.trim()}`;
        } else {
          wellFormed = false;
          break;
        }
      }
      if (wellFormed && items.length > 0) {
        blocks.push({
          kind: 'list',
          html: items.map((i) => `<li>${inline(i)}</li>`).join(''),
          ordered: numbered,
        });
        continue;
      }
    }

    // ---- paragraph. Only the first one of an article takes a drop cap, and
    // only when it starts with a letter — a drop cap on a quotation mark or a
    // digit looks like a mistake rather than a flourish.
    const html = inline(raw.replace(/\n/g, ' '));
    const dropCap = !sawFirstPara && /^[A-Za-z]/.test(raw);
    sawFirstPara = true;
    blocks.push(dropCap ? { kind: 'para', html, dropCap: true } : { kind: 'para', html });
  }

  return blocks;
}

/** Stable content hash, used as part of the ledger cache key. */
export function hashString(text: string): string {
  // FNV-1a, 32-bit. Not cryptographic — it only has to notice that an
  // article's body changed between two scans.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
