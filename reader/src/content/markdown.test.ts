/**
 * Markdown parser tests.
 *
 * The parser is pure and the grammar is deliberately narrow, so the useful
 * thing to pin down is the boundary: what it accepts, what it refuses, and
 * that a malformed construct degrades to a paragraph rather than throwing.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';
import type { Block } from '../model/types';

const kinds = (md: string) => parseMarkdown(md).map((b) => b.kind);
const table = (md: string) =>
  parseMarkdown(md).find((b) => b.kind === 'table') as
    | Extract<Block, { kind: 'table' }>
    | undefined;

const SIMPLE = `
| Index | Close | Change |
|:---|---:|---:|
| S&P 500 | 5,412.66 | −38.21 |
| Nasdaq | 17,884.02 | −146.55 |
`.trim();

describe('tables', () => {
  it('parses a pipe table with a header and rows', () => {
    const t = table(SIMPLE)!;
    expect(t.head).toEqual(['Index', 'Close', 'Change']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![0]).toBe('S&amp;P 500');
  });

  it('reads alignment from the delimiter row', () => {
    expect(table(SIMPLE)!.align).toEqual(['left', 'right', 'right']);
    const centred = table('| a | b |\n|:-:|---|\n| 1 | 2 |')!;
    expect(centred.align).toEqual(['center', 'left']);
  });

  it('tolerates missing outer pipes', () => {
    const t = table('a | b\n---|---\n1 | 2')!;
    expect(t.head).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2']]);
  });

  it('pads a ragged row rather than dropping the table', () => {
    const t = table('| a | b | c |\n|---|---|---|\n| 1 | 2 |')!;
    expect(t.rows[0]).toEqual(['1', '2', '']);
  });

  it('escapes cell content', () => {
    const t = table('| x |\n|---|\n| <script>bad</script> |')!;
    expect(t.rows[0]![0]).not.toContain('<script>');
  });

  it('keeps inline emphasis inside cells', () => {
    const t = table('| x |\n|---|\n| **up** |')!;
    expect(t.rows[0]![0]).toBe('<strong>up</strong>');
  });

  it('absorbs a preceding h3 as the table label', () => {
    const blocks = parseMarkdown(`### Equities\n\n${SIMPLE}`);
    expect(blocks.map((b) => b.kind)).toEqual(['table']);
    expect((blocks[0] as Extract<Block, { kind: 'table' }>).label).toBe('Equities');
  });

  it('leaves prose containing a pipe as a paragraph', () => {
    // No delimiter row, so this is a sentence, not a table.
    expect(kinds('Use grep | sort to see it.')).toEqual(['para']);
  });

  it('refuses a table whose delimiter is not the second line', () => {
    expect(kinds('| a |\n| b |\n|---|')).toEqual(['para']);
  });

  it('refuses a header with no body rows', () => {
    expect(kinds('| a | b |\n|---|---|')).toEqual(['para']);
  });
});

describe('links', () => {
  const html = (md: string) =>
    (parseMarkdown(md)[0] as Extract<Block, { kind: 'para' }>).html;

  it('links an http(s) URL and opens it away from the paper', () => {
    const out = html('See [Reuters](https://www.reuters.com/markets/x).');
    expect(out).toContain('href="https://www.reuters.com/markets/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer noopener"');
    expect(out).toContain('>Reuters</a>');
  });

  // This is the security-relevant case. Article bodies are written by a
  // language model from feeds nobody controls, so a hostile href is a
  // realistic input rather than a hypothetical one.
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\u0000script:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '//evil.example.com',
    'HTTPS\u0009://evil.example.com',
  ])('refuses %s and keeps only the link text', (href) => {
    const out = html(`a [click me](${href}) b`);
    expect(out).toContain('click me');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href');
  });

  it('never emits an href it did not validate', () => {
    const out = html('[x](https://ok.example.com/a"onmouseover="alert(1))');
    expect(out).not.toContain('onmouseover');
  });
});

describe('other blocks', () => {
  it('folds wrapped list items back into one item', () => {
    const blocks = parseMarkdown('- one that wraps\n  onto a second line\n- two');
    const list = blocks[0] as Extract<Block, { kind: 'list' }>;
    expect(list.kind).toBe('list');
    expect(list.html).toBe('<li>one that wraps onto a second line</li><li>two</li>');
  });

  it('turns a blockquote into a pull quote, with attribution', () => {
    const blocks = parseMarkdown('> a claim\n> — Someone');
    const q = blocks[0] as Extract<Block, { kind: 'pullquote' }>;
    expect(q.kind).toBe('pullquote');
    expect(q.html).toBe('a claim');
    expect(q.attribution).toBe('Someone');
  });

  it('gives only the first paragraph a drop cap, and only if it starts a word', () => {
    const blocks = parseMarkdown('First para.\n\nSecond para.');
    expect((blocks[0] as Extract<Block, { kind: 'para' }>).dropCap).toBe(true);
    expect((blocks[1] as Extract<Block, { kind: 'para' }>).dropCap).toBeUndefined();
    expect(
      (parseMarkdown('"Quoted" opening.')[0] as Extract<Block, { kind: 'para' }>).dropCap,
    ).toBeUndefined();
  });

  it('escapes markup in prose', () => {
    const p = parseMarkdown('<img src=x onerror=alert(1)>')[0] as Extract<
      Block,
      { kind: 'para' }
    >;
    expect(p.html).not.toContain('<img');
  });

  it('never throws on hostile or empty input', () => {
    for (const input of ['', '|', '||||', '---', '>', '- ', '#', '###', '|\n|\n|']) {
      expect(() => parseMarkdown(input)).not.toThrow();
    }
  });
});
