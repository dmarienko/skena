import type { CanvasNode, CellNode } from '../../shared/types';
import { CARD_CODE_BORDER, nodeBorderColor } from './palette';

// - a card body shows at most this many lines
export const CARD_LINES = 3;

/** One line of a card body that is not code, markdown or a picture. */
export interface CardRow { text: string; style: 'strong' | 'path' | 'plain' | 'mono' }

export type CardBody =
  | { kind: 'code'; lines: string[]; language: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'rows'; rows: CardRow[] }
  | { kind: 'image'; src: string };

/** What the card of one node shows: its label and type in the header, its border, and its body. */
export interface CardContent {
  label?: string;
  typeText: string;
  border: string;
  body: CardBody;
}

/** What a card needs beyond the node itself. */
export interface CardExtra {
  /** - the label of the code cell whose output this cell is */
  ownerLabel?: string;
  /** - the text of a markdown file, when its file preview has already loaded it */
  fileText?: string;
}

const FENCE = /^(```|~~~)/;
// - a formula block opens with one of these alone on a line and closes with its pair
const MATH_CLOSE: Record<string, string> = { '$$': '$$', '%%': '%%', '\\[': '\\]' };
// - a thematic break: three or more of one of - * _
const RULE = /^([-*_])(\s*\1){2,}$/;

/**
 * The blocks of a markdown text in reading order, one string each: a line of prose, or a whole
 * formula block with its delimiters. Blank lines, rules and fenced code are left out.
 */
function mdBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || RULE.test(t)) continue;
    if (FENCE.test(t)) {
      const mark = t.slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) i++;
      continue;
    }
    const close = MATH_CLOSE[t];
    if (close !== undefined) {
      const block = [t];
      i++;
      while (i < lines.length && lines[i].trim() !== close) block.push(lines[i++]);
      block.push(close);
      out.push(block.join('\n'));
      continue;
    }
    out.push(t);
  }
  return out;
}

function headingText(block: string): string | undefined {
  const m = /^#{1,6}\s+(.+)$/.exec(block);
  return m ? m[1].trim() : undefined;
}

// - heading, quote and list markers go, so each block renders as one plain line
const plainLine = (block: string): string =>
  block.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');

/**
 * The markdown a note's card renders: the first heading in bold, then the blocks after it as plain
 * lines, CARD_LINES in all. A note with no heading shows its first CARD_LINES blocks.
 */
export function noteSnippet(text: string): string {
  const blocks = mdBlocks(text);
  const at = blocks.findIndex(b => headingText(b) !== undefined);
  const picked = at < 0
    ? blocks.slice(0, CARD_LINES).map(plainLine)
    : [`**${headingText(blocks[at])}**`, ...blocks.slice(at + 1, at + CARD_LINES).map(plainLine)];
  return picked.join('\n\n');
}

/** The text of the first heading of a markdown text, outside fenced code. */
export function firstHeading(text: string): string | undefined {
  for (const b of mdBlocks(text)) {
    const h = headingText(b);
    if (h !== undefined) return h;
  }
  return undefined;
}

// - ends of blocks a browser starts a new line after
const BLOCK_END = /<\/(p|div|tr|li|h[1-6]|table|thead|tbody|ul|ol|blockquote)>|<br\s*\/?>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The lines of text an html output shows, tags removed, blank lines dropped. Inside `<pre>` the
 * spacing and the line breaks are kept; elsewhere whitespace folds as a browser folds it, a table
 * row reads as one line with its cells one space apart.
 */
export function htmlLines(html: string): string[] {
  const cleaned = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const parts = cleaned.split(/(<pre\b[\s\S]*?<\/pre>)/i);
  const lines: string[] = [];
  parts.forEach((part, i) => {
    const pre = i % 2 === 1;
    const text = pre
      ? part.replace(/<[^>]*>/g, '')
      : part.replace(/\s+/g, ' ').replace(BLOCK_END, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]*>/g, '').replace(/ {2,}/g, ' ');
    for (const line of decodeEntities(text).split('\n')) {
      const kept = pre ? line.trimEnd() : line.trim();
      if (kept.trim() !== '') lines.push(kept);
    }
  });
  return lines;
}

function extOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function cardBorder(node: CanvasNode & { accentColor?: string }): string {
  // - the default code border is too dark to see on the card background
  if (node.type === 'code' && node.accentColor === undefined) return CARD_CODE_BORDER;
  return nodeBorderColor(node.type, node.accentColor);
}

function cellBody(node: CellNode): CardBody {
  switch (node.format) {
    case 'image':    return { kind: 'image', src: node.content };
    case 'markdown': return { kind: 'markdown', text: noteSnippet(node.content) };
    case 'plotly':   return { kind: 'rows', rows: [{ text: 'plot', style: 'plain' }] };
    case 'html':     return { kind: 'rows', rows: htmlLines(node.content).slice(0, CARD_LINES).map(text => ({ text, style: 'mono' })) };
  }
}

// - what the node's own header shows: its title, file or URL
function headerRows(node: CanvasNode): CardRow[] {
  switch (node.type) {
    case 'link':
      return [{ text: node.url, style: 'path' }];
    case 'portal':
      return node.label
        ? [{ text: node.label, style: 'strong' }, { text: node.canvas, style: 'path' }]
        : [{ text: node.canvas, style: 'path' }];
    case 'noderef': {
      const rows: CardRow[] = [{ text: `${node.canvas} › ${node.label}`, style: 'path' }];
      if (node.title) rows.push({ text: node.title, style: 'plain' });
      return rows;
    }
    case 'chat':
      return [{ text: node.title, style: 'strong' }];
    case 'kernel':
      return [{ text: node.displayName ?? 'kernel', style: 'strong' }, { text: node.server, style: 'path' }];
    case 'group':
      return node.label ? [{ text: node.label, style: 'strong' }] : [];
    default:
      return [];
  }
}

/**
 * The card `g` shows for `node`, the node at the other end of a connection. Built from the data the
 * webview already holds; nothing is fetched.
 */
export function cardContent(node: CanvasNode & { accentColor?: string }, extra: CardExtra = {}): CardContent {
  const head = { label: node.nodeLabel, border: cardBorder(node) };
  switch (node.type) {
    case 'code': {
      const language = node.language ?? 'python';
      const lines = node.code.split(/\r?\n/).filter(l => l.trim() !== '').slice(0, CARD_LINES).map(l => l.trimEnd());
      return { ...head, typeText: `code · ${language}`, body: { kind: 'code', lines, language } };
    }
    case 'text':
      return { ...head, typeText: 'note', body: { kind: 'markdown', text: noteSnippet(node.text) } };
    case 'file': {
      const ext = extOf(node.file);
      const heading = extra.fileText === undefined ? undefined : firstHeading(extra.fileText);
      const rows: CardRow[] = [{ text: node.file, style: 'path' }];
      if (heading !== undefined) rows.push({ text: heading, style: 'strong' });
      return { ...head, typeText: ext ? `file · ${ext}` : 'file', body: { kind: 'rows', rows } };
    }
    case 'cell':
      return {
        ...head,
        typeText: extra.ownerLabel ? `output of ${extra.ownerLabel}` : `cell · ${node.format}`,
        body: cellBody(node),
      };
    case 'knowledge':
      return {
        ...head,
        typeText: 'knowledge',
        body: { kind: 'rows', rows: [{ text: node.title, style: 'strong' }, { text: node.uri, style: 'path' }] },
      };
    default:
      return { ...head, typeText: node.type, body: { kind: 'rows', rows: headerRows(node) } };
  }
}
