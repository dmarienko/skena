/**
 * MarksPanel — popup list of all stored vim-style canvas bookmarks.
 *
 * Open with Ctrl+M from canvas navigation mode.
 * Keys: ↑/↓ navigate, Enter jump, Escape close.
 * Stale entries (node removed) are shown dimmed and skipped by Enter.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Node } from '@xyflow/react';
import { CanvasMark } from '../../shared/types';

// ─── title extraction ─────────────────────────────────────────────────────────

function nodeTitle(data: Record<string, unknown>, type: string): string {
  if (type === 'text') {
    const text  = (data.text as string) ?? '';
    const first = text.split('\n').find(l => l.trim()) ?? '';
    return first.replace(/^#+\s+/, '').trim().slice(0, 60) || '(empty)';
  }
  if (type === 'file') {
    const file = (data.file as string) ?? '';
    return (file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file).slice(0, 60) || '(file)';
  }
  if (type === 'link') {
    return ((data.url as string) ?? '').slice(0, 60) || '(link)';
  }
  if (type === 'portal') {
    const canvas = (data.canvas as string) ?? '';
    return (canvas.split('/').pop()?.replace(/\.canvas$/, '') ?? canvas).slice(0, 60) || '(portal)';
  }
  return (data.nodeLabel as string) ?? `[${type}]`;
}

// ─── types ────────────────────────────────────────────────────────────────────

interface MarkEntry {
  register: string;
  mark:     CanvasMark;
  title:    string;
  /** - false when the node the mark points to no longer exists */
  jumpable: boolean;
}

interface Props {
  marks:   Record<string, CanvasMark>;
  nodes:   Node[];
  onJump:  (register: string) => void;
  onClose: () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export function MarksPanel({ marks, nodes, onJump, onClose }: Props): JSX.Element {
  // - build sorted entry list: named marks first (alphabetical), then `` ` ``
  const entries: MarkEntry[] = [];
  const sorted = Object.entries(marks)
    .filter(([reg]) => reg !== '`')
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [register, mark] of sorted) {
    const node     = mark.nodeId ? nodes.find(n => n.id === mark.nodeId) : undefined;
    const jumpable = mark.nodeId === null || node != null;
    const title    = node
      ? nodeTitle(node.data as Record<string, unknown>, node.type ?? '')
      : mark.nodeId ? '(node removed)' : '(position only)';
    entries.push({ register, mark, title, jumpable });
  }

  // - `` ` `` previous-position register at the bottom
  if (marks['`']) {
    const mark     = marks['`'];
    const node     = mark.nodeId ? nodes.find(n => n.id === mark.nodeId) : undefined;
    const jumpable = mark.nodeId === null || node != null;
    const title    = node
      ? `← ${nodeTitle(node.data as Record<string, unknown>, node.type ?? '')}`
      : '(previous position)';
    entries.push({ register: '`', mark, title, jumpable });
  }

  // - start selection on first jumpable entry
  const firstJumpable = entries.findIndex(e => e.jumpable);
  const [sel, setSel] = useState(firstJumpable >= 0 ? firstJumpable : 0);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // - scroll selected row into view
  useEffect(() => {
    rowRefs.current[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // - keyboard navigation (capture phase: beats Monaco + any canvas handler)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
        e.preventDefault(); e.stopPropagation();
        setSel(s => {
          let next = s;
          do { next = (next + 1) % entries.length; } while (!entries[next]?.jumpable && next !== s);
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault(); e.stopPropagation();
        setSel(s => {
          let next = s;
          do { next = (next - 1 + entries.length) % entries.length; } while (!entries[next]?.jumpable && next !== s);
          return next;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (entries[sel]?.jumpable) onJump(entries[sel].register);
        return;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [entries, sel, onJump, onClose]);

  return (
    // - click backdrop to close
    <div
      onClick={onClose}
      style={{
        position:        'absolute', inset: 0,
        zIndex:          2000,
        display:         'flex',
        alignItems:      'flex-start',
        justifyContent:  'center',
        paddingTop:      '18vh',
        background:      'transparent',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   'var(--vscode-editorWidget-background, #1e1e1e)',
          border:       '1px solid var(--vscode-editorWidget-border, #454545)',
          borderRadius: 8,
          boxShadow:    '0 8px 32px rgba(0,0,0,0.6)',
          minWidth:     380,
          maxWidth:     520,
          maxHeight:    '60vh',
          overflow:     'hidden',
          display:      'flex',
          flexDirection:'column',
        }}
      >
        {/* header */}
        <div style={{
          padding:      '7px 12px',
          fontSize:     11,
          fontFamily:   'var(--vscode-font-family)',
          color:        'var(--vscode-descriptionForeground, #888)',
          borderBottom: '1px solid var(--vscode-editorWidget-border, #454545)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Bookmarks {entries.length > 0 ? `(${entries.filter(e => e.jumpable).length})` : ''}
        </div>

        {entries.length === 0 ? (
          <div style={{
            padding:    '16px 12px',
            fontSize:   13,
            fontFamily: 'var(--vscode-font-family)',
            color:      'var(--vscode-descriptionForeground, #888)',
          }}>
            No bookmarks yet — press <kbd style={{ fontFamily: 'monospace', fontSize: 11 }}>m</kbd> then a key to set one.
          </div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            {entries.map((entry, i) => {
              const isSelected = i === sel;
              return (
                <div
                  key={entry.register}
                  ref={el => { rowRefs.current[i] = el; }}
                  onClick={() => entry.jumpable && onJump(entry.register)}
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        10,
                    padding:    '5px 12px',
                    cursor:     entry.jumpable ? 'pointer' : 'default',
                    opacity:    entry.jumpable ? 1 : 0.35,
                    background: isSelected
                      ? 'var(--vscode-list-activeSelectionBackground, #094771)'
                      : 'transparent',
                    color: isSelected
                      ? 'var(--vscode-list-activeSelectionForeground, #fff)'
                      : 'var(--vscode-foreground, #ccc)',
                  }}
                  onMouseEnter={() => entry.jumpable && setSel(i)}
                >
                  {/* register key badge */}
                  <span style={{
                    fontFamily:  'var(--vscode-editor-font-family, monospace)',
                    fontSize:    12,
                    minWidth:    18,
                    textAlign:   'center',
                    background:  isSelected
                      ? 'rgba(255,255,255,0.15)'
                      : 'var(--vscode-badge-background, #4d4d4d)',
                    color: isSelected
                      ? 'inherit'
                      : 'var(--vscode-badge-foreground, #fff)',
                    borderRadius: 3,
                    padding:     '1px 5px',
                    flexShrink:  0,
                  }}>
                    {entry.register}
                  </span>

                  {/* separator */}
                  <span style={{ color: 'var(--vscode-descriptionForeground, #666)', flexShrink: 0 }}>—</span>

                  {/* title */}
                  <span style={{
                    fontFamily: 'var(--vscode-font-family)',
                    fontSize:   13,
                    overflow:   'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.title}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* footer hint */}
        <div style={{
          padding:      '4px 12px',
          fontSize:     10,
          fontFamily:   'var(--vscode-font-family)',
          color:        'var(--vscode-descriptionForeground, #666)',
          borderTop:    entries.length > 0 ? '1px solid var(--vscode-editorWidget-border, #454545)' : 'none',
        }}>
          ↑↓ navigate  ·  Enter jump  ·  Esc close
        </div>
      </div>
    </div>
  );
}
