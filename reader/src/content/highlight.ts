/**
 * Syntax colouring for the source view.
 *
 * highlight.js, with only the three grammars an edition can contain: YAML for
 * the frontmatter, Markdown for the body, JSON for the manifest. The markdown
 * grammar knows nothing about frontmatter, so an article is split at its
 * fences and each half is coloured by the grammar that understands it.
 */

import hljs from 'highlight.js/lib/core';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('json', json);

export type SourceKind = 'article' | 'manifest';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

function colour(text: string, language: string): string {
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}

/** Return HTML for `text`, safe to place inside a `<code>` element. */
export function highlightSource(text: string, kind: SourceKind): string {
  if (kind === 'manifest') return colour(text, 'json');

  const m = FRONTMATTER.exec(text);
  if (!m) return colour(text, 'markdown');

  const [, frontmatter, body] = m;
  return [
    '<span class="hljs-fence">---</span>',
    colour(frontmatter!, 'yaml'),
    '<span class="hljs-fence">---</span>',
    colour(body!, 'markdown'),
  ].join('\n');
}
