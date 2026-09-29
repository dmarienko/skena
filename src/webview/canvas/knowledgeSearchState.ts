/**
 * The knowledge dialog's state, as a reducer with no React and no messages in it, so the
 * keyboard behaviour (highlight, scope cycling, server switch) and the order of the result list
 * are testable on their own.
 */

import type { KnowledgeCapabilities, KnowledgeHit } from '../../shared/knowledge/types';

export interface SearchState {
  server: string; servers: { name: string; capabilities: KnowledgeCapabilities }[];
  query: string; scope: string; scopes: string[]; recency: boolean;
  // - highlight is an index into groupHits(hits), and never a file line
  hits: KnowledgeHit[]; highlight: number; status: string;
}

export type SearchAction =
  | { kind: 'type'; query: string } | { kind: 'hits'; hits: KnowledgeHit[] } | { kind: 'error'; message: string }
  | { kind: 'move'; by: 1 | -1 } | { kind: 'cycleScope' } | { kind: 'scopes'; scopes: string[] }
  | { kind: 'toggleRecency' } | { kind: 'server'; name: string };

// - `#tag` tokens leave the query text and become the tags filter; the rest is the search text
export function splitTags(query: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = query.replace(/(^|\s)#([\w-]+)/g, (_, sp: string, t: string) => { tags.push(t); return sp; }).replace(/\s+/g, ' ').trim();
  return { text, tags };
}

// - the two controls a server's capabilities decide, and the query the dialog sends. Kept here so
//   they are checked without React: the dialog only reads them.
export function showsServerSelector(rows: { name: string }[]): boolean {
  return rows.length > 1;
}

export function showsFilterRow(caps: KnowledgeCapabilities | undefined): boolean {
  return !!(caps?.scopes || caps?.recency);
}

// - a server without a tags filter gets the #tokens as part of the text, as typed
export function queryFor(query: string, caps: KnowledgeCapabilities | undefined): { text: string; tags: string[] } {
  return caps?.tags ? splitTags(query) : { text: query.trim(), tags: [] };
}

// - a uri without its #fragment: the whole document a section hit points into. The fragment
//   starts at the first "#", the split parseCrtxUri makes, so a heading holding "#" stays whole
export function fileUriOf(uri: string): string {
  const i = uri.indexOf('#');
  return i < 0 ? uri : uri.slice(0, i);
}

export function fileNameOf(uri: string): string {
  const file = fileUriOf(uri);
  return file.slice(file.lastIndexOf('/') + 1);
}

// - Shift+Enter: the same hit, pointed at its whole document
export function wholeDocumentHit(hit: KnowledgeHit): KnowledgeHit {
  return { ...hit, uri: fileUriOf(hit.uri), title: fileNameOf(hit.uri) };
}

export type ResultRow =
  | { kind: 'file'; server: string; uri: string; name: string; subtitle?: string; count: number }
  | { kind: 'hit'; hit: KnowledgeHit; underFile: boolean };

/**
 * The result list in display order. Hits of one document (same server, same uri up to the "#")
 * are listed together at the place of the best-ranked one: a document with one hit is a plain
 * row; with more, a file line that cannot be highlighted, then each hit in ranked order.
 */
export function groupHits(hits: KnowledgeHit[]): ResultRow[] {
  const byFile = new Map<string, KnowledgeHit[]>();
  for (const h of hits) {
    const key = `${h.server}\u0000${fileUriOf(h.uri)}`;
    const same = byFile.get(key);
    if (same) same.push(h); else byFile.set(key, [h]);
  }
  const rows: ResultRow[] = [];
  // - a Map keeps insertion order, so each document sits where its first hit came
  for (const same of byFile.values()) {
    const first = same[0];
    if (same.length === 1) { rows.push({ kind: 'hit', hit: first, underFile: false }); continue; }
    rows.push({ kind: 'file', server: first.server, uri: fileUriOf(first.uri), name: fileNameOf(first.uri), subtitle: first.subtitle, count: same.length });
    for (const h of same) rows.push({ kind: 'hit', hit: h, underFile: true });
  }
  return rows;
}

// - a hit with no fragment, or an empty one, is the whole document
export function sectionLabel(hit: KnowledgeHit): string {
  return `› ${hit.uri.length > fileUriOf(hit.uri).length + 1 ? hit.title : 'whole file'}`;
}

// - clamps at both ends: no wrap from the last row to the first or back
export function moveHighlight(rows: ResultRow[], from: number, by: 1 | -1): number {
  for (let i = from + by; i >= 0 && i < rows.length; i += by) {
    if (rows[i].kind === 'hit') return i;
  }
  return from;
}

const firstHitRow = (rows: ResultRow[]) => Math.max(0, rows.findIndex(r => r.kind === 'hit'));

export function reduce(s: SearchState, a: SearchAction): SearchState {
  switch (a.kind) {
    case 'type':          return { ...s, query: a.query };
    case 'hits':          return { ...s, hits: a.hits, highlight: firstHitRow(groupHits(a.hits)), status: `${a.hits.length} result${a.hits.length === 1 ? '' : 's'}` };
    case 'error':         return { ...s, hits: [], highlight: 0, status: a.message };
    case 'move':          return s.hits.length ? { ...s, highlight: moveHighlight(groupHits(s.hits), s.highlight, a.by) } : s;
    case 'scopes':        return { ...s, scopes: a.scopes };
    case 'cycleScope':    { const all = ['all', ...s.scopes]; const i = all.indexOf(s.scope); return { ...s, scope: all[(i + 1) % all.length] }; }
    case 'toggleRecency': return { ...s, recency: !s.recency };
    case 'server':        return { ...s, server: a.name, scope: 'all', scopes: [], hits: [], highlight: 0 };
  }
}

export const initialState = (servers: SearchState['servers']): SearchState =>
  ({ server: servers[0]?.name ?? '', servers, query: '', scope: 'all', scopes: [], recency: false, hits: [], highlight: 0, status: servers.length ? '' : 'no knowledge server configured (skena.knowledge.servers)' });
