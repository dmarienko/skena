/**
 * KnowledgeSearch — search the configured knowledge servers (Ctrl+F) and put one result on the
 * canvas. The dialog knows nothing about a server's tools or URL scheme: it posts
 * knowledgeServers / knowledgeSearch / knowledgeFetch / knowledgeScopes and reads the answers
 * the host sends back, matched by requestId.
 *
 * Keys while the dialog is open:
 *   ↑ / ↓, Ctrl+J / Ctrl+K   → move the highlight
 *   Tab                      → next scope (only when the server has scopes)
 *   Enter                    → add the highlighted hit to the canvas
 *   Esc                      → close
 *   Ctrl+F                   → back to the input
 *
 * ↑ / ↓, Tab and Enter need the input focused. Esc, Ctrl+F and Ctrl+J/K work wherever the focus
 * is: while the dialog is open the canvas forwards those and swallows the rest.
 *
 * A server with `facets` also answers with its tag names; a `#tag` the server does not have is
 * left out of the search and named in the status line.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KnowledgeHit, KnowledgeText } from '../../shared/knowledge/types';
import type {
  MsgKnowledgeFacetsResult, MsgKnowledgeFetchResult, MsgKnowledgeScopesResult, MsgKnowledgeSearchResult,
  MsgKnowledgeServersResult,
} from '../../shared/types';
import { MarkdownRenderer } from '../renderers/MarkdownRenderer';
import { useKnowledgeAssets } from './knowledgeAssets';
import { initialState, queryFor, reduce, showsFilterRow, showsServerSelector } from './knowledgeSearchState';
import type { SearchAction, SearchState } from './knowledgeSearchState';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - one counter for every request the dialog sends, so a slow answer that arrives after a newer
// - request can be recognised and dropped
let requestCounter = 0;
const nextRequestId = (): number => ++requestCounter;

type ServerRow = MsgKnowledgeServersResult['servers'][number];

// - two things the pure reducer has no action for: the server list arriving, and a click on a row
type LocalAction = SearchAction | { kind: 'servers'; servers: ServerRow[] } | { kind: 'highlight'; index: number };

function reduceLocal(s: SearchState, a: LocalAction): SearchState {
  if (a.kind === 'highlight') return { ...s, highlight: a.index };
  if (a.kind !== 'servers')   return reduce(s, a);
  const base = initialState(a.servers.map(r => ({ name: r.name, capabilities: r.capabilities })));
  // - a server whose provider failed to build answers nothing; open on the first one that can
  const usable = a.servers.find(r => !r.error);
  if (usable) return { ...base, server: usable.name };
  return a.servers.length ? { ...base, status: a.servers[0].error ?? '' } : base;
}

const CHIP: React.CSSProperties = {
  fontSize: 11, padding: '1px 6px', borderRadius: 3, cursor: 'pointer', userSelect: 'none',
  border: '1px solid var(--vscode-editorWidget-border, #454545)',
  color: 'var(--vscode-descriptionForeground, #999)',
  background: 'transparent',
};

interface Props {
  onPick:  (hit: KnowledgeHit, text: KnowledgeText | null) => void;
  onClose: () => void;
}

export function KnowledgeSearch({ onPick, onClose }: Props): JSX.Element {
  // - the no-server message belongs to an answered knowledgeServers, not to the moment before it
  const [state, dispatch] = useReducer(reduceLocal, undefined, () => ({ ...initialState([]), status: '' }));
  const [rows, setRows]       = useState<ServerRow[]>([]);
  const [preview, setPreview] = useState<{ uri: string; text: KnowledgeText | null; error: string }>({ uri: '', text: null, error: '' });
  // - Enter on a hit whose text is not cached: the parent fetches it and the dialog stays open
  const [pending, setPending] = useState('');
  // - the tag names each server has, per scope; a key that is absent means "not asked or not
  // - answered", and then a #tag goes to the server unchecked
  const [knownTags, setKnownTags] = useState<Map<string, Set<string>>>(new Map());
  const [tagNote, setTagNote]     = useState('');

  const cache      = useRef<Map<string, KnowledgeText>>(new Map());
  const inputRef   = useRef<HTMLInputElement>(null);
  const listRef    = useRef<HTMLDivElement>(null);
  const searchId   = useRef(0);
  const fetchId    = useRef(0);
  const scopesId   = useRef(0);
  const facetsId   = useRef(0);
  // - which (server, scope) the in-flight facets request belongs to
  const pendingFacetsKey = useRef('');

  const caps      = state.servers.find(s => s.name === state.server)?.capabilities;
  const facetsKey = `${state.server}\u0000${state.scope}`;
  // - the preview shows the section's images, from the same cache the nodes use
  const { swapMarkdown } = useKnowledgeAssets(state.server);

  useEffect(() => {
    inputRef.current?.focus();
    vscodePostMessage({ type: 'knowledgeServers' });
  }, []);

  useEffect(() => {
    const onServers = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeServersResult>).detail;
      setRows(msg.servers);
      dispatch({ kind: 'servers', servers: msg.servers });
      // - the host could not read the settings at all; say that rather than "no server configured"
      if (msg.error) dispatch({ kind: 'error', message: msg.error });
    };
    const onScopes = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeScopesResult>).detail;
      if (msg.requestId !== scopesId.current || !msg.scopes) return;
      dispatch({ kind: 'scopes', scopes: msg.scopes });
    };
    const onSearch = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeSearchResult>).detail;
      if (msg.requestId !== searchId.current) return;
      if (msg.error) dispatch({ kind: 'error', message: msg.error });
      else           dispatch({ kind: 'hits', hits: msg.hits ?? [] });
    };
    const onFetch = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeFetchResult>).detail;
      if (msg.requestId !== fetchId.current) return;
      if (msg.error || !msg.text) { setPreview(p => ({ ...p, error: msg.error ?? 'no text' })); return; }
      const text = msg.text;
      cache.current.set(text.uri, text);
      setPreview(p => (p.uri === text.uri ? { uri: p.uri, text, error: '' } : p));
    };
    const onFacets = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeFacetsResult>).detail;
      // - an error leaves the key uncached, so the tags stay unchecked rather than all rejected
      if (msg.requestId !== facetsId.current || msg.error || !msg.tags) return;
      const names = new Set(msg.tags.map(([t]) => t));
      const key = pendingFacetsKey.current;
      setKnownTags(m => new Map(m).set(key, names));
    };
    // - Ctrl+F pressed while the focus sits on a row, the preview or the server list
    const onFocusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    // - Ctrl+J/K pressed while the focus sits on a row, the preview or the server list
    const onMove = (e: Event) => {
      dispatch({ kind: 'move', by: (e as CustomEvent<{ by: 1 | -1 }>).detail.by });
    };
    // - the parent's fetch for Enter failed; it keeps the dialog open and sends the message here
    const onPickError = (e: Event) => {
      setPending('');
      setPreview(p => ({ ...p, error: (e as CustomEvent<{ message: string }>).detail.message }));
    };
    window.addEventListener('skena:knowledgeServersResult', onServers);
    window.addEventListener('skena:knowledgeScopesResult',  onScopes);
    window.addEventListener('skena:knowledgeSearchResult',  onSearch);
    window.addEventListener('skena:knowledgeFetchResult',   onFetch);
    window.addEventListener('skena:knowledgeFacetsResult',  onFacets);
    window.addEventListener('skena:knowledgePickError',     onPickError);
    window.addEventListener('skena:knowledgeFocus',         onFocusInput);
    window.addEventListener('skena:knowledgeMove',          onMove);
    return () => {
      window.removeEventListener('skena:knowledgeServersResult', onServers);
      window.removeEventListener('skena:knowledgeScopesResult',  onScopes);
      window.removeEventListener('skena:knowledgeSearchResult',  onSearch);
      window.removeEventListener('skena:knowledgeFetchResult',   onFetch);
      window.removeEventListener('skena:knowledgeFacetsResult',  onFacets);
      window.removeEventListener('skena:knowledgePickError',     onPickError);
      window.removeEventListener('skena:knowledgeFocus',         onFocusInput);
      window.removeEventListener('skena:knowledgeMove',          onMove);
    };
  }, []);

  // - the scope list belongs to one server; ask again after a server switch
  useEffect(() => {
    if (!state.server || !caps?.scopes) return;
    const id = nextRequestId();
    scopesId.current = id;
    vscodePostMessage({ type: 'knowledgeScopes', requestId: id, server: state.server });
  }, [state.server, caps?.scopes]);

  // - the tag names belong to one server and one scope; ask once per pair, and only for a server
  // - that has facets at all
  useEffect(() => {
    if (!state.server || !caps?.facets || knownTags.has(facetsKey)) return;
    const id = nextRequestId();
    facetsId.current = id;
    pendingFacetsKey.current = facetsKey;
    vscodePostMessage({
      type: 'knowledgeFacets', requestId: id, server: state.server,
      ...(state.scope !== 'all' ? { scope: state.scope } : {}),
    });
  }, [facetsKey, state.server, state.scope, caps?.facets, knownTags]);

  useEffect(() => {
    // - this run replaces whatever is in flight, so a reply to the previous request — the query
    // - just cleared, the server just switched away from — no longer matches the id
    searchId.current = nextRequestId();
    if (!state.server) return;
    const { text, tags } = queryFor(state.query, caps);
    // - nothing typed yet: clear the list, and no status text to report about it
    if (!text && tags.length === 0) { setTagNote(''); dispatch({ kind: 'error', message: '' }); return; }
    // - with the server's tag names in hand, a tag it does not have is left out; without them
    // - (no facets, or the answer has not arrived) every tag goes as typed
    const known   = knownTags.get(facetsKey);
    const unknown = known ? tags.filter(t => !known.has(t)) : [];
    const useTags = known ? tags.filter(t => known.has(t)) : tags;
    setTagNote(unknown.length ? `no such tag: ${unknown.join(', ')}` : '');
    // - the whole query was unknown tags: nothing left to search for
    if (!text && useTags.length === 0) { dispatch({ kind: 'hits', hits: [] }); return; }
    const timer = setTimeout(() => {
      const id = nextRequestId();
      searchId.current = id;
      vscodePostMessage({
        type: 'knowledgeSearch', requestId: id, server: state.server,
        query: {
          text, top: 20,
          ...(caps?.tags && useTags.length ? { tags: useTags } : {}),
          ...(state.scope !== 'all' ? { scope: state.scope } : {}),
          ...(state.recency ? { recency: true } : {}),
        },
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [state.query, state.server, state.scope, state.recency, caps?.tags, facetsKey, knownTags]);

  // - keep the highlighted row inside the list's own scroll range; scrollTop is set by hand
  // - (not row.scrollIntoView) so a scrollable ancestor outside the list is never touched.
  // - offsetTop counts from the list's top only because the list is position: relative; without
  // - it the offsetParent is the dialog, and the search panel's height is added to every row
  useEffect(() => {
    const list = listRef.current;
    const row  = list?.querySelector<HTMLElement>(`[data-index="${state.highlight}"]`);
    if (!list || !row) return;
    const top    = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [state.highlight, state.hits]);

  // - the preview follows the highlight once it settles, so walking a list with ↓ fetches once
  const hit = state.hits[state.highlight] as KnowledgeHit | undefined;
  useEffect(() => {
    if (!hit) { setPreview({ uri: '', text: null, error: '' }); return; }
    const cached = cache.current.get(hit.uri);
    if (cached) { setPreview({ uri: hit.uri, text: cached, error: '' }); return; }
    setPreview({ uri: hit.uri, text: null, error: '' });
    const timer = setTimeout(() => {
      const id = nextRequestId();
      fetchId.current = id;
      vscodePostMessage({ type: 'knowledgeFetch', requestId: id, server: hit.server, uri: hit.uri });
    }, 150);
    return () => clearTimeout(timer);
  }, [hit?.uri, hit?.server]);

  const pick = useCallback((h: KnowledgeHit) => {
    if (pending) return;   // - a fetch for the previous Enter is still out
    const text = cache.current.get(h.uri) ?? null;
    setPending(text ? '' : 'fetching…');
    onPick(h, text);
  }, [onPick, pending]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // - no Escape here: while the dialog is open the canvas keydown handler owns it, so the two
    //   would otherwise both close it on one press
    if (e.key === 'ArrowDown') { e.preventDefault(); dispatch({ kind: 'move', by:  1 }); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); dispatch({ kind: 'move', by: -1 }); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'j') { e.preventDefault(); dispatch({ kind: 'move', by:  1 }); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'k') { e.preventDefault(); dispatch({ kind: 'move', by: -1 }); return; }
    // - a server with scopes consumes Tab even before its scope list arrives, so Tab never walks
    // - the focus off to the × button; without scopes there is nothing to cycle and Tab does its
    // - usual job
    if (e.key === 'Tab' && caps?.scopes) { e.preventDefault(); dispatch({ kind: 'cycleScope' }); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // - without this the same keydown reaches CanvasView's window listener once the picked
      // - node is selected, and Enter opens it in the browser right after adding it
      e.stopPropagation();
      const h = state.hits[state.highlight];
      if (h) pick(h);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f') {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [caps?.scopes, state.hits, state.highlight, pick]);

  // - the hit count and the message of the moment are two segments, so neither hides the other
  const note   = pending || preview.error || tagNote;
  const status = [state.status, note].filter(Boolean).join(' · ');

  // - re-swapped only when the previewed text or an image it references changes, not on every
  //   keystroke in the search box
  const previewText = useMemo(
    () => preview.text ? swapMarkdown(preview.text.text) : null,
    [preview.text, swapMarkdown],
  );

  return (
    <div
      className="skena-knowledge-search nowheel"
      style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
        width: 'min(900px, 90%)', maxHeight: '60vh', display: 'flex', flexDirection: 'column',
        background: 'var(--vscode-editorWidget-background, #1e1e1e)',
        border: '1px solid var(--vscode-editorWidget-border, #454545)',
        borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}
      // - stop clicks from propagating to ReactFlow (would deselect nodes)
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px' }}>
        <svg
          width="13" height="13" viewBox="0 0 16 16"
          fill="none" stroke="var(--vscode-input-foreground, #ccc)" strokeWidth="1.8"
          style={{ flexShrink: 0, opacity: 0.7 }}
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10" y1="10" x2="14" y2="14" />
        </svg>

        {showsServerSelector(rows) && (
          <select
            value={state.server}
            onChange={e => dispatch({ kind: 'server', name: e.target.value })}
            style={{
              fontSize: 11, background: 'var(--vscode-dropdown-background, #3c3c3c)',
              color: 'var(--vscode-dropdown-foreground, #ccc)',
              border: '1px solid var(--vscode-dropdown-border, #454545)', borderRadius: 3, padding: '1px 3px',
            }}
          >
            {rows.map(r => (
              <option key={r.name} value={r.name} disabled={!!r.error} title={r.error}>
                {r.error ? `${r.name} — ${r.error}` : r.name}
              </option>
            ))}
          </select>
        )}

        <input
          ref={inputRef}
          value={state.query}
          onChange={e => dispatch({ kind: 'type', query: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder={caps?.tags ? 'search the knowledge servers — #tag filters' : 'search the knowledge servers'}
          spellCheck={false}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--vscode-input-foreground, #ccc)',
            fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 13, minWidth: 0,
          }}
        />

        <button
          title="Close (Esc)"
          onClick={onClose}
          style={{ ...CHIP, border: 'none', color: 'var(--vscode-icon-foreground, #ccc)', fontSize: 13 }}
        >×</button>
      </div>

      {showsFilterRow(caps) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 5px 27px' }}>
          {caps?.scopes && (
            <span
              title="Next scope (Tab)"
              onClick={() => dispatch({ kind: 'cycleScope' })}
              style={{ ...CHIP, color: state.scope === 'all' ? CHIP.color : 'var(--vscode-input-foreground, #ccc)' }}
            >
              scope: {state.scope}
            </span>
          )}
          {caps?.recency && (
            <span
              title="Prefer recent results"
              onClick={() => dispatch({ kind: 'toggleRecency' })}
              style={{
                ...CHIP,
                color: state.recency ? 'var(--vscode-badge-foreground, #fff)' : CHIP.color,
                background: state.recency ? 'var(--vscode-badge-background, #4d4d4d)' : 'transparent',
              }}
            >
              recent
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, borderTop: '1px solid var(--vscode-editorWidget-border, #454545)' }}>
        {/* - skena-scrollable is what CanvasView's own wheel-zoom handler checks for (not
             nowheel — see CodeNode.tsx's read-only preview), so this is what actually keeps
             the wheel scrolling the list instead of zooming the canvas underneath */}
        <div ref={listRef} className="nowheel skena-scrollable" style={{ position: 'relative', width: '55%', overflowY: 'auto', overflowX: 'hidden' }}>
          {state.hits.map((h, i) => (
            <div
              key={h.uri + i}
              data-index={i}
              onClick={() => dispatch({ kind: 'highlight', index: i })}
              onDoubleClick={() => pick(h)}
              style={{
                padding: '4px 8px', cursor: 'pointer', fontSize: 12,
                borderBottom: '1px solid var(--vscode-editorWidget-border, #454545)',
                background: i === state.highlight ? 'var(--vscode-list-activeSelectionBackground, #094771)' : 'transparent',
                color: i === state.highlight
                  ? 'var(--vscode-list-activeSelectionForeground, #fff)'
                  : 'var(--vscode-input-foreground, #ccc)',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                {h.date && <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 'auto', flexShrink: 0 }}>{h.date}</span>}
              </div>
              <div style={{ fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.subtitle}{h.subtitle && h.tags.length > 0 ? ' · ' : ''}{h.tags.map(t => `#${t}`).join(' ')}
              </div>
              <div style={{ fontSize: 11, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.snippet}
              </div>
            </div>
          ))}
        </div>
        <div
          className="nowheel skena-scrollable"
          style={{
            width: '45%', overflow: 'auto', padding: '6px 10px', fontSize: 12,
            borderLeft: '1px solid var(--vscode-editorWidget-border, #454545)',
            color: 'var(--vscode-input-foreground, #ccc)',
          }}
        >
          {previewText !== null
            ? <MarkdownRenderer content={previewText} baseUri="." />
            : <span style={{ opacity: 0.6 }}>{preview.error || (hit ? 'loading…' : '')}</span>}
        </div>
      </div>

      <div
        style={{
          display: 'flex', gap: 6, padding: '3px 8px', fontSize: 11,
          borderTop: '1px solid var(--vscode-editorWidget-border, #454545)',
          color: 'var(--vscode-descriptionForeground, #999)',
        }}
      >
        <span>{state.server || 'no server'}</span>
        {status && <><span style={{ opacity: 0.5 }}>·</span><span>{status}</span></>}
      </div>
    </div>
  );
}
