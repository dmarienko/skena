/**
 * The knowledge dialog's state, as a reducer with no React and no messages in it, so the
 * keyboard behaviour (highlight, scope cycling, server switch) is testable on its own.
 */

import type { KnowledgeCapabilities, KnowledgeHit } from '../../shared/knowledge/types';

export interface SearchState {
  server: string; servers: { name: string; capabilities: KnowledgeCapabilities }[];
  query: string; scope: string; scopes: string[]; recency: boolean;
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

export function reduce(s: SearchState, a: SearchAction): SearchState {
  switch (a.kind) {
    case 'type':          return { ...s, query: a.query };
    case 'hits':          return { ...s, hits: a.hits, highlight: 0, status: `${a.hits.length} result${a.hits.length === 1 ? '' : 's'}` };
    case 'error':         return { ...s, hits: [], highlight: 0, status: a.message };
    case 'move':          return s.hits.length ? { ...s, highlight: (s.highlight + a.by + s.hits.length) % s.hits.length } : s;
    case 'scopes':        return { ...s, scopes: a.scopes };
    case 'cycleScope':    { const all = ['all', ...s.scopes]; const i = all.indexOf(s.scope); return { ...s, scope: all[(i + 1) % all.length] }; }
    case 'toggleRecency': return { ...s, recency: !s.recency };
    case 'server':        return { ...s, server: a.name, scope: 'all', scopes: [], hits: [], highlight: 0 };
  }
}

export const initialState = (servers: SearchState['servers']): SearchState =>
  ({ server: servers[0]?.name ?? '', servers, query: '', scope: 'all', scopes: [], recency: false, hits: [], highlight: 0, status: servers.length ? '' : 'no knowledge server configured (skena.knowledge.servers)' });
