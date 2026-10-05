// - pure Typst span replacement on MDAST plain objects; no unified/DOM deps. Unit-tested.
// - markdown reads `_`, `*`, `~` inside a `%…%` span as emphasis/strong/delete before Typst is
// - looked for, so a span can be split across several phrasing nodes. Spans are therefore found in
// - the raw source each paragraph / heading / table cell covers (node positions are offsets into
// - the exact string remark parsed), and a span whose two ends sit in different text nodes is
// - rendered from its raw body. A span inside one text node is rendered from the node's value.
import { findTypstSpans } from './typst-delim';

export interface MdPoint { line: number; column: number; offset?: number }
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: MdPoint; end: MdPoint };
  [key: string]: unknown;
}
export type TypstCompile = (body: string, block: boolean) => string;

interface Span { start: number; end: number; open: number; block: boolean }

// - nodes whose children are phrasing content and that sit directly in flow content
const PHRASING_BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);
// - the only nodes a split span may cross: what `_`, `*`, `~` produce
const CROSSABLE = new Set(['emphasis', 'strong', 'delete']);

const startOf = (n: MdNode): number => n.position?.start.offset ?? -1;
const endOf = (n: MdNode): number => n.position?.end.offset ?? -1;

/**
 * Replace every Typst span under `parent` with an `html` node holding `compile(body, block)`.
 * `source` is the string `parent` was parsed from; without it only spans inside one text node are found.
 */
export function renderTypstSpans(parent: MdNode, source: string, compile: TypstCompile): void {
  renderSplitSpans(parent, source, compile);
  renderTextSpans(parent, compile);
}

function renderSplitSpans(node: MdNode, source: string, compile: TypstCompile): void {
  if (PHRASING_BLOCKS.has(node.type)) { splitSpansIn(node, source, compile); return; }
  for (const c of node.children ?? []) renderSplitSpans(c, source, compile);
}

function splitSpansIn(block: MdNode, source: string, compile: TypstCompile): void {
  const from = startOf(block), to = endOf(block);
  if (from < 0 || to > source.length || !block.children?.length) return;
  const found: Span[] = [];
  let base = from;
  let spans = findTypstSpans(source.slice(base, to));
  let k = 0;
  while (k < spans.length) {
    const s = spans[k];
    const span: Span = { start: base + s.start, end: base + s.end, open: s.block ? 2 : 1, block: s.block };
    const kind = classify(block, source, span);
    if (kind === 'reject') {
      // - this opening delimiter is not one: look again from just after it, as findTypstSpans
      // - does for an opening with no close
      base = span.start + span.open;
      spans = findTypstSpans(source.slice(base, to));
      k = 0;
      continue;
    }
    if (kind === 'split') found.push(span);
    k++;
  }
  // - right to left: a split keeps correct offsets on the parts left of the cut, which is where
  // - the remaining spans are
  for (let i = found.length - 1; i >= 0; i--) replaceSpan(block, source, found[i], compile);
}

// - 'single': both ends in one text node (renderTextSpans handles it); 'split': across text nodes
// - through emphasis/strong/delete only; 'reject': not a span
function classify(block: MdNode, source: string, span: Span): 'single' | 'split' | 'reject' {
  const head = pathTo(block, span.start), tail = pathTo(block, span.end - 1);
  const first = head[head.length - 1], last = tail[tail.length - 1];
  if (!first || !last || first.type !== 'text' || last.type !== 'text') return 'reject';
  // - a %% delimiter must lie in one text node
  if (endOf(first) < span.start + span.open || startOf(last) > span.end - span.open) return 'reject';
  if (first === last) return 'single';
  // - the raw body of a span over several lines would carry `>` / list indentation
  if (source.slice(span.start, span.end).includes('\n')) return 'reject';
  const { kids, a, b } = crossedChildren(block, head, tail);
  for (let i = a; i <= b; i++) if (!crossable(kids[i], span.start, span.end)) return 'reject';
  if (!samePercents(first, source) || !samePercents(last, source)) return 'reject';
  return 'split';
}

function replaceSpan(block: MdNode, source: string, span: Span, compile: TypstCompile): void {
  const { kids, a, b } = crossedChildren(block, pathTo(block, span.start), pathTo(block, span.end - 1));
  const html: MdNode = {
    type: 'html',
    value: compile(source.slice(span.start + span.open, span.end - span.open), span.block),
    position: { start: pointAt(source, block, span.start), end: pointAt(source, block, span.end) },
  };
  const left = partBefore(kids[a], span.start, source, block);
  const right = partAfter(kids[b], span.end, source, block);
  kids.splice(a, b - a + 1, ...[left, html, right].filter((n): n is MdNode => n !== null));
}

// - the nodes from a child of `node` down to the deepest one whose range holds `offset`
function pathTo(node: MdNode, offset: number): MdNode[] {
  const path: MdNode[] = [];
  let cur: MdNode | undefined = node;
  while (cur) {
    cur = cur.children?.find(c => startOf(c) <= offset && offset < endOf(c));
    if (cur) path.push(cur);
  }
  return path;
}

// - the deepest node holding both ends, and the indices of its children holding each end
function crossedChildren(block: MdNode, head: MdNode[], tail: MdNode[]): { kids: MdNode[]; a: number; b: number } {
  let d = 0;
  while (d < head.length && d < tail.length && head[d] === tail[d]) d++;
  const kids = (d === 0 ? block : head[d - 1]).children ?? [];
  return { kids, a: kids.indexOf(head[d]), b: kids.indexOf(tail[d]) };
}

function crossable(n: MdNode, start: number, end: number): boolean {
  if (endOf(n) <= start || startOf(n) >= end) return true;
  if (n.type === 'text') return true;
  if (!CROSSABLE.has(n.type)) return false;
  return (n.children ?? []).every(c => crossable(c, start, end));
}

const countPercents = (s: string): number => s.split('%').length - 1;

// - a text node's value drops escapes and line indentation, so a source offset is mapped to the
// - value through the count of `%` before it; that needs the same number of `%` in both
// - (`&#37;` would add one to the value only)
function samePercents(n: MdNode, source: string): boolean {
  return countPercents(source.slice(startOf(n), endOf(n))) === countPercents(n.value ?? '');
}

// - index in the value of the `%` at source offset `offset`
function valueIndex(n: MdNode, source: string, offset: number): number {
  const k = countPercents(source.slice(startOf(n), offset));
  const v = n.value ?? '';
  let i = -1;
  for (let j = 0; j <= k; j++) i = v.indexOf('%', i + 1);
  return i;
}

// - the part of `n` before source offset `cut` (an opening `%` inside a text node), or null if empty
function partBefore(n: MdNode, cut: number, source: string, block: MdNode): MdNode | null {
  const end = pointAt(source, block, cut);
  if (n.type === 'text') {
    const value = (n.value ?? '').slice(0, valueIndex(n, source, cut));
    return value ? { type: 'text', value, position: { start: n.position!.start, end } } : null;
  }
  const kids: MdNode[] = [];
  for (const c of n.children ?? []) {
    if (endOf(c) <= cut) { kids.push(c); continue; }
    if (startOf(c) < cut) {
      const part = partBefore(c, cut, source, block);
      if (part) kids.push(part);
    }
    break;
  }
  return kids.length ? { ...n, children: kids, position: { start: n.position!.start, end } } : null;
}

// - the part of `n` from source offset `cut` (just after a closing `%` inside a text node), or null
function partAfter(n: MdNode, cut: number, source: string, block: MdNode): MdNode | null {
  const start = pointAt(source, block, cut);
  if (n.type === 'text') {
    const value = (n.value ?? '').slice(valueIndex(n, source, cut - 1) + 1);
    return value ? { type: 'text', value, position: { start, end: n.position!.end } } : null;
  }
  const kids: MdNode[] = [];
  for (const c of n.children ?? []) {
    if (startOf(c) >= cut) kids.push(c);
    else if (endOf(c) > cut) {
      const part = partAfter(c, cut, source, block);
      if (part) kids.push(part);
    }
  }
  return kids.length ? { ...n, children: kids, position: { start, end: n.position!.end } } : null;
}

// - line/column of `offset`, counted from the block's start so the cost is the block's length
function pointAt(source: string, block: MdNode, offset: number): MdPoint {
  const from = block.position!.start;
  const at = from.offset ?? 0;
  let line = from.line, lineStart = -1;
  for (let i = at; i < offset; i++) if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
  const column = lineStart < 0 ? from.column + (offset - at) : offset - lineStart + 1;
  return { line, column, offset };
}

function renderTextSpans(node: MdNode, compile: TypstCompile): void {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.type !== 'text') { renderTextSpans(c, compile); continue; }
    if (typeof c.value !== 'string') continue;
    const spans = findTypstSpans(c.value);
    if (spans.length === 0) continue;
    const out: MdNode[] = [];
    let last = 0;
    for (const s of spans) {
      if (s.start > last) out.push({ type: 'text', value: c.value.slice(last, s.start) });
      out.push({ type: 'html', value: compile(s.body, s.block) });
      last = s.end;
    }
    if (last < c.value.length) out.push({ type: 'text', value: c.value.slice(last) });
    kids.splice(i, 1, ...out);
    i += out.length - 1;
  }
}
