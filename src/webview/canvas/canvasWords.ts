// - pure word list for completion in the text-node editor and the chat input (no React, no Monaco).
// - Words come from the text on the current canvas plus its node labels.

import type { CanvasNode } from '../../shared/types';

export interface WordCount {
  word:  string;
  count: number;
}

export const MIN_WORD_LEN = 3;
export const MAX_SUGGESTIONS = 50;

const WORD = /[\p{L}\p{N}_]+/gu;
const WORD_AT_END = /[\p{L}\p{N}_]+$/u;
// - pasted images are base64 data URIs; their payload is not words
const DATA_URI = /data:[^;,\s)"']*;base64,[A-Za-z0-9+/=]+/g;

/**
 * Words of `text` with at least MIN_WORD_LEN characters, split on anything that is not a letter, digit or _.
 */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    if (m[0].length >= MIN_WORD_LEN) out.push(m[0]);
  }
  return out;
}

// - kernel text output is stored as HTML (<pre> with ANSI colour spans); keep only the visible text
function htmlText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, ' ');
}

/**
 * The text of one node that contributes words: note text, code-cell source, knowledge title and text,
 * text outputs. Other node kinds contribute only their label.
 */
export function nodeWordText(n: CanvasNode): string {
  switch (n.type) {
    case 'text':      return n.text.replace(DATA_URI, ' ');
    case 'code':      return n.code;
    case 'knowledge': return `${n.title} ${n.text.replace(DATA_URI, ' ')}`;
    case 'cell':
      if (n.format === 'markdown') return n.content.replace(DATA_URI, ' ');
      if (n.format === 'html')     return htmlText(n.content.replace(DATA_URI, ' '));
      return '';   // - image and plotly cells hold base64 / figure JSON
    default:          return '';
  }
}

/**
 * Every word on the canvas with its number of occurrences: most frequent first, then alphabetical.
 * Node labels (N8, E17) count once each and are kept whatever their length.
 */
export function buildWordList(nodes: CanvasNode[]): WordCount[] {
  const counts = new Map<string, number>();
  const add = (w: string) => counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const n of nodes) {
    for (const w of splitWords(nodeWordText(n))) add(w);
    if (n.nodeLabel) add(n.nodeLabel);
  }
  const list = [...counts].map(([word, count]) => ({ word, count }));
  list.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    const la = a.word.toLowerCase(), lb = b.word.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
  });
  return list;
}

/**
 * Words of `list` that start with `typed` (case-insensitive), in list order, without `typed` itself.
 */
export function matchWords(list: WordCount[], typed: string, cap = MAX_SUGGESTIONS): string[] {
  const prefix = typed.toLowerCase();
  const out: string[] = [];
  for (const { word } of list) {
    if (out.length >= cap) break;
    if (word !== typed && word.toLowerCase().startsWith(prefix)) out.push(word);
  }
  return out;
}

/**
 * The letters, digits and _ directly before the cursor; `lineBefore` is the line up to the cursor.
 */
export function wordBefore(lineBefore: string): string {
  return lineBefore.match(WORD_AT_END)?.[0] ?? '';
}
