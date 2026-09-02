import { describe, expect, it } from 'vitest';
import { highlightSource } from './highlight';

describe('highlightSource', () => {
  it('colours the frontmatter as YAML and the body as Markdown', () => {
    const html = highlightSource(
      '---\nheadline: Hello\npriority: 2\n---\n\n## A heading\n\nSome *emphasis*.\n',
      'article',
    );
    expect(html).toContain('hljs-fence');
    expect(html).toContain('<span class="hljs-attr">headline:</span>');
    expect(html).toContain('hljs-section');
    expect(html).toContain('hljs-emphasis');
  });

  it('escapes anything that could otherwise become markup', () => {
    const html = highlightSource('---\nheadline: <b>x</b>\n---\n<script>alert(1)</script>\n', 'article');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to plain Markdown when there is no frontmatter', () => {
    expect(highlightSource('# Just a body\n', 'article')).toContain('hljs-section');
  });

  it('colours a manifest as JSON', () => {
    expect(highlightSource('{"schema": 1}', 'manifest')).toContain('hljs-attr');
  });
});
