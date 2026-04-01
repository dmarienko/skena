/**
 * CanvasSearch — find-in-canvas overlay (Ctrl+F).
 *
 * Floats at the top-centre of the canvas. Matches nodes by:
 *   • label      N4, J2, r1 … (case-insensitive, prefix OK)
 *   • text       any substring in node content / filename / URL / title
 *   • tags       partial match against tag list
 *
 * Keyboard shortcuts while the bar is open:
 *   Enter          → next result
 *   Shift+Enter    → previous result
 *   ↑ / ↓         → previous / next result
 *   Ctrl+F         → re-open / next result (prevents browser find)
 *   Escape         → close
 *
 * The parent calls focusNode(id) whenever the active result changes;
 * the search bar itself has no knowledge of the React Flow instance.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CanvasNode } from '../../shared/types';

interface Props {
  nodes:     CanvasNode[];
  onFocus:   (id: string) => void;
  onClose:   () => void;
}

// ─── matching ─────────────────────────────────────────────────────────────────

function nodeContent(n: CanvasNode): string {
  switch (n.type) {
    case 'text':   return n.text;
    case 'file':   return n.file;
    case 'link':   return n.url;
    case 'group':  return n.label ?? '';
    case 'cell':   return n.content;
    case 'chat':   return `${n.agent} ${n.title}`;
    case 'portal': return n.canvas;
    default:       return '';
  }
}

function matches(n: CanvasNode, q: string): boolean {
  const ql = q.toLowerCase();

  // - label: exact or prefix (N4, n4, "n" → all text nodes)
  const label = n.nodeLabel?.toLowerCase() ?? '';
  if (label === ql || label.startsWith(ql)) return true;

  // - content substring
  if (nodeContent(n).toLowerCase().includes(ql)) return true;

  // - tags
  const tags = (n as { tags?: string[] }).tags;
  if (tags?.some(t => t.toLowerCase().includes(ql))) return true;

  return false;
}

// ─── component ────────────────────────────────────────────────────────────────

export function CanvasSearch({ nodes, onFocus, onClose }: Props): JSX.Element {
  const [query,   setQuery]   = useState('');
  const [index,   setIndex]   = useState(0);
  const inputRef              = useRef<HTMLInputElement>(null);

  // - auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // - compute results whenever query or nodes change
  const results: CanvasNode[] = query.trim()
    ? nodes.filter(n => matches(n, query.trim()))
    : [];

  const total   = results.length;
  const current = total > 0 ? Math.min(index, total - 1) : -1;

  // - when results or index change, pan to active node, then restore input focus.
  // - TextNode's skena:focusNode handler calls wrapperRef.focus() synchronously,
  // - so we reclaim focus in the next animation frame (after all event handlers run).
  useEffect(() => {
    if (current >= 0) {
      onFocus(results[current].id);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, query]); // - results identity changes with query

  // - clamp index when result count shrinks
  useEffect(() => {
    if (index >= total && total > 0) setIndex(total - 1);
  }, [total, index]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    setIndex(i => (i + 1) % total);
  }, [total]);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    setIndex(i => (i - 1 + total) % total);
  }, [total]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goPrev() : goNext();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); goNext(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); goPrev(); return; }
    // - absorb Ctrl+F so it doesn't close and re-open the bar
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); goNext(); }
  }, [goPrev, goNext, onClose]);

  // ─── label printed next to the counter ──────────────────────────────────────
  const counterLabel = query.trim() === ''
    ? ''
    : total === 0
      ? 'no results'
      : `${current + 1} / ${total}`;

  const noMatch = query.trim() !== '' && total === 0;

  return (
    <div
      style={{
        position:     'absolute',
        top:          10,
        left:         '50%',
        transform:    'translateX(-50%)',
        zIndex:       1000,
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        padding:      '5px 8px',
        background:   'var(--vscode-editorWidget-background, #1e1e1e)',
        border:       '1px solid var(--vscode-editorWidget-border, #454545)',
        borderRadius: 6,
        boxShadow:    '0 4px 16px rgba(0,0,0,0.5)',
        minWidth:     260,
      }}
      // - stop clicks from propagating to ReactFlow (would deselect nodes)
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* - magnifier icon */}
      <svg
        width="13" height="13" viewBox="0 0 16 16"
        fill="none" stroke="var(--vscode-input-foreground, #ccc)" strokeWidth="1.8"
        style={{ flexShrink: 0, opacity: 0.7 }}
      >
        <circle cx="6.5" cy="6.5" r="4.5" />
        <line x1="10" y1="10" x2="14" y2="14" />
      </svg>

      {/* - text input */}
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={handleKey}
        placeholder="label or text…"
        spellCheck={false}
        style={{
          flex:        1,
          background:  'transparent',
          border:      'none',
          outline:     'none',
          color:       noMatch
            ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
            : 'var(--vscode-input-foreground, #ccc)',
          fontFamily:  'var(--vscode-editor-font-family, monospace)',
          fontSize:    13,
          minWidth:    0,
        }}
      />

      {/* - result counter */}
      {counterLabel && (
        <span style={{
          fontSize:    11,
          color:       noMatch
            ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
            : 'var(--vscode-descriptionForeground, #999)',
          whiteSpace:  'nowrap',
          userSelect:  'none',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {counterLabel}
        </span>
      )}

      {/* - prev / next buttons */}
      {total > 1 && (
        <>
          <NavButton title="Previous (Shift+Enter)" onClick={goPrev}>
            <svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 2 L1 7 L9 7 Z" /></svg>
          </NavButton>
          <NavButton title="Next (Enter)" onClick={goNext}>
            <svg viewBox="0 0 10 10" fill="currentColor"><path d="M5 8 L1 3 L9 3 Z" /></svg>
          </NavButton>
        </>
      )}

      {/* - close button */}
      <NavButton title="Close (Esc)" onClick={onClose}>
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </NavButton>
    </div>
  );
}

// ─── tiny nav button ──────────────────────────────────────────────────────────

function NavButton({
  onClick, title, children,
}: {
  onClick: () => void;
  title:   string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background:   'none',
        border:       'none',
        cursor:       'pointer',
        padding:      '2px 3px',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        color:        'var(--vscode-icon-foreground, #ccc)',
        opacity:      0.7,
        borderRadius: 3,
        flexShrink:   0,
        width:        20,
        height:       20,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <svg width="10" height="10" style={{ display: 'block' }}>
        {children}
      </svg>
    </button>
  );
}
