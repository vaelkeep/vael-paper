/**
 * Types shared across the reader.
 *
 * The wire half mirrors `server/vael_paper/models.py`. The layout half is
 * documented in the plan; the short version is that pagination is integer
 * arithmetic over *lines*, and every type below that mentions a count of lines
 * means baseline units, never pixels.
 */

export type ArticleId = string;
export type SectionId = string;
export type Span = 'full' | '2col' | '1col';
/** Where to hold an image when it must be cropped to fit its box. */
export type Focus = 'top' | 'center' | 'bottom';
export type Align = 'left' | 'center' | 'right';

// ---------------------------------------------------------------- wire

export interface Warning {
  scope: string;
  code: string;
  message: string;
  /** Where to look, when the scanner knew. */
  file?: string | null;
  line?: number | null;
}

export interface ImageAsset {
  key: string;
  src: string;
  w: number;
  h: number;
  /** h / w. Space is reserved from this before the image loads. */
  aspect: number;
  dominant: string;
  /** Photographs and line art take opposite treatment in the night theme. */
  is_photo: boolean;
}

export interface ArticleRef {
  id: ArticleId;
  file: string;
  headline: string;
  deck: string | null;
  section: SectionId;
  byline: string | null;
  priority: number;
  span: Span;
  image: string | null;
  caption: string | null;
  focus: Focus;
  sources: SourceRef[];
  word_count: number;
  body: string;
  /** The file as written, frontmatter included. Absent from older exports. */
  source?: string;
}

export interface SourceRef {
  name: string;
  url: string | null;
  title: string | null;
}

export interface Section {
  id: SectionId;
  name: string;
  articles: ArticleId[];
}

export interface EditionManifest {
  schema: number;
  /** The manifest as written, for the source view, and which file it was. */
  manifest_source?: string | null;
  manifest_file?: string | null;
  /** Advice from the server's lint pass; the edition prints regardless. */
  lint?: Warning[];
  id: string;
  date: string;
  volume: number;
  number: number;
  masthead: string;
  motto: string | null;
  generated_at: string | null;
  front_template: string | null;
  content_hash: string;
  sections: Section[];
  articles: ArticleRef[];
  images: Record<string, ImageAsset>;
  warnings: Warning[];
}

export interface EditionSummary {
  id: string;
  date: string;
  volume: number;
  number: number;
  masthead: string;
  article_count: number;
  warning_count: number;
}

// ---------------------------------------------------------------- content

export type Block =
  | { kind: 'heading'; level: 2 | 3; html: string }
  | { kind: 'para'; html: string; dropCap?: boolean }
  | {
      kind: 'figure';
      imageKey: string;
      caption?: string;
      scope: 'col' | 'region';
      focus?: Focus;
    }
  | { kind: 'pullquote'; html: string; attribution?: string; anchorBlock: number }
  | { kind: 'list'; html: string; ordered: boolean }
  | {
      kind: 'table';
      /** Column headings; empty when the table is headless. */
      head: string[];
      rows: string[][];
      align: Align[];
      /** An optional label set above the table, in small caps. */
      label?: string;
    }
  | { kind: 'sources'; sources: SourceRef[] }
  | { kind: 'rule' };

export interface ParsedArticle {
  id: ArticleId;
  meta: ArticleRef;
  blocks: Block[];
  hash: string;
}

// ---------------------------------------------------------------- measurement

export interface BlockMetrics {
  index: number;
  kind: Block['kind'];
  /** Height in baseline units. */
  lines: number;
  /** `margin-block-start` in baseline units; only charged at a block's start. */
  leadLines: number;
  /** Figures, pull quotes and rules never split across a column. */
  atomic: boolean;
  /** Headings and decks must not be stranded at the foot of a column. */
  keepWithNext: boolean;
  /**
   * The mirror of `keepWithNext`: a credit line must not begin a column,
   * separated from the story it belongs to.
   */
  keepWithPrevious: boolean;
  /**
   * For a table with a heading row: how many baselines the heading occupies
   * and the line index at which the body rows begin (after any label). A
   * continuation that starts at or past `bodyStart` repeats the heading.
   */
  head?: { lines: number; bodyStart: number };
}

/**
 * Note what is *absent*: page height. Line breaking depends only on measure, so
 * a height-only change (an iPad toolbar collapsing, a window resized
 * vertically) reuses the ledger and costs a repack rather than a remeasure.
 */
export interface LedgerKey {
  articleId: ArticleId;
  contentHash: string;
  colW: number;
  fontScale: number;
  fontsVersion: string;
}

export interface LineLedger {
  key: LedgerKey;
  lineHeight: number;
  totalLines: number;
  blocks: BlockMetrics[];
}

// ---------------------------------------------------------------- geometry

export type ReadingMode = 'single' | 'spread' | 'scroll';

export interface GridMetrics {
  pageW: number;
  pageH: number;
  margins: { t: number; r: number; b: number; l: number };
  cols: number;
  gutter: number;
  colW: number;
  ruleW: number;
  lineHeight: number;
  linesPerPage: number;
  /** Tallest a figure may be, in baselines. See MAX_FIGURE_SHARE. */
  maxFigureLines: number;
  fontScale: number;
  mode: ReadingMode;
}

export interface LayoutKey {
  colW: number;
  pageW: number;
  pageH: number;
  fontScale: number;
  mode: ReadingMode;
  fontsVersion: string;
  templateSetId: string;
}

// ---------------------------------------------------------------- plan

/** A position in the edition: which article, which block, which line within it. */
export interface Cursor {
  articleId: ArticleId;
  blockIndex: number;
  lineIndex: number;
}

export interface SliceRef {
  articleId: ArticleId;
  fromBlock: number;
  fromLine: number;
  toBlock: number;
  toLine: number;
  heightLines: number;
  isArticleStart: boolean;
  isArticleEnd: boolean;
  /** Baselines of repeated table heading drawn above the slice's first line. */
  headLines?: number;
}

export interface ColumnFill {
  regionId: string;
  colIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  items: SliceRef[];
}

export interface JumpLine {
  kind: 'to' | 'from';
  articleId: ArticleId;
  page: number;
  columnIndex: number;
}

export type PageAnchor = Cursor;
