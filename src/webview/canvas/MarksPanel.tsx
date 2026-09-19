/**
 * MarksPanel — popup list of the canvas sections and of all stored vim-style bookmarks.
 *
 * Open with Ctrl+M from canvas navigation mode.
 * Keys: ↑/↓ navigate, Enter go (a section unfolds and focuses its first node), Escape close.
 * Stale entries (node removed) are shown dimmed and skipped by Enter.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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

/** One section of the canvas, in stack order; the caller resolves the title it shows. */
export interface SectionEntry {
  id:     string;
  label:  string;
  title:  string;
  count:  number;
  folded: boolean;
}

/** A selectable row of the panel: the sections first, then the marks. */
type Row =
  | { kind: 'section'; key: string; badge: string; title: string; meta: string; id: string }
  | { kind: 'mark';    key: string; badge: string; title: string; meta: string; register: string };

interface Props {
  marks:         Record<string, CanvasMark>;
  nodes:         Node[];
  sections:      SectionEntry[];
  onJump:        (register: string) => void;
  onPickSection: (id: string) => void;
  onClose:       () => void;
}

const GroupLabel = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div style={{
    padding:       '5px 12px 2px',
    fontSize:      10,
    fontFamily:    'var(--vscode-font-family)',
    color:         'var(--vscode-descriptionForeground, #888)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  }}>
    {children}
  </div>
);

// ─── component ────────────────────────────────────────────────────────────────

export function MarksPanel({ marks, nodes, sections, onJump, onPickSection, onClose }: Props): JSX.Element {
  // - build sorted entry list: named marks first (alphabetical), then `` ` ``
  const entries: MarkEntry[] = [];
  const sorted = Object.entries(marks)
    .filter(([reg]) => reg !== '`')
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [register, mark] of sorted) {
    const node     = mark.nodeId ? nodes.find(n => n.id === mark.nodeId) : undefined;
    const jumpable = mark.nodeId === null || node != null;
    // - hide marks whose target node was deleted
    if (!jumpable) continue;
    const title = node
      ? nodeTitle(node.data as Record<string, unknown>, node.type ?? '')
      : '(position only)';
    entries.push({ register, mark, title, jumpable: true });
  }

  // - `` ` `` previous node at the bottom; hidden once that node is gone, since the jump goes to
  //   the node itself and no longer falls back to the stored viewport
  const previous     = marks['`'];
  const previousNode = previous?.nodeId ? nodes.find(n => n.id === previous.nodeId) : undefined;
  if (previous && previousNode) {
    const title = `← ${nodeTitle(previousNode.data as Record<string, unknown>, previousNode.type ?? '')}`;
    entries.push({ register: '`', mark: previous, title, jumpable: true });
  }

  const sectionRows: Row[] = sections.map(s => ({
    kind: 'section', key: `section:${s.id}`, id: s.id, badge: s.label, title: s.title,
    meta: `${s.count} nodes${s.folded ? ' · folded' : ''}`,
  }));
  const markRows: Row[] = entries.map(e => ({
    kind: 'mark', key: `mark:${e.register}`, register: e.register, badge: e.register, title: e.title, meta: '',
  }));
  // - the section stack reads top to bottom, so it goes above the marks and the panel opens on it
  const rows: Row[] = [...sectionRows, ...markRows];

  // - all displayed rows can be chosen; start on the first
  const [sel, setSel] = useState(0);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // - scroll selected row into view
  useEffect(() => {
    rowRefs.current[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // - a mark jumps to its node, a section unfolds and focuses its first; both close the panel
  const activate = useCallback((row: Row) => {
    if (row.kind === 'section') onPickSection(row.id);
    else onJump(row.register);
  }, [onJump, onPickSection]);

  // - keyboard navigation (capture phase: beats Monaco + any canvas handler)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        onClose();
        return;
      }
      if (rows.length === 0) return;
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
        e.preventDefault(); e.stopPropagation();
        setSel(s => (s + 1) % rows.length);
        return;
      }
      if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault(); e.stopPropagation();
        setSel(s => (s - 1 + rows.length) % rows.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (rows[sel]) activate(rows[sel]);
        return;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [rows, sel, activate, onClose]);

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
          {sectionRows.length > 0
            ? 'Sections & bookmarks'
            : `Bookmarks ${entries.length > 0 ? `(${entries.length})` : ''}`}
        </div>

        {rows.length === 0 ? (
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
            {rows.map((row, i) => {
              const isSelected = i === sel;
              return (
                <React.Fragment key={row.key}>
                  {/* - the group labels only appear once there are sections to separate from the marks */}
                  {i === 0 && sectionRows.length > 0 && <GroupLabel>Sections</GroupLabel>}
                  {i === sectionRows.length && sectionRows.length > 0 && markRows.length > 0 && <GroupLabel>Bookmarks</GroupLabel>}
                  <div
                    ref={el => { rowRefs.current[i] = el; }}
                    onClick={() => activate(row)}
                    style={{
                      display:    'flex',
                      alignItems: 'center',
                      gap:        10,
                      padding:    '5px 12px',
                      cursor:     'pointer',
                      background: isSelected
                        ? 'var(--vscode-list-activeSelectionBackground, #094771)'
                        : 'transparent',
                      color: isSelected
                        ? 'var(--vscode-list-activeSelectionForeground, #fff)'
                        : 'var(--vscode-foreground, #ccc)',
                    }}
                    onMouseEnter={() => setSel(i)}
                  >
                    {/* register key / section label badge */}
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
                      {row.badge}
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
                      {row.title}
                    </span>

                    {/* - a section's node count, and `folded` when it is */}
                    {row.meta !== '' && (
                      <span style={{
                        fontFamily: 'var(--vscode-font-family)',
                        fontSize:   11,
                        color:      isSelected ? 'inherit' : 'var(--vscode-descriptionForeground, #888)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        marginLeft: 'auto',
                      }}>
                        {row.meta}
                      </span>
                    )}
                  </div>
                </React.Fragment>
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
          borderTop:    rows.length > 0 ? '1px solid var(--vscode-editorWidget-border, #454545)' : 'none',
        }}>
          ↑↓ navigate  ·  Enter go  ·  Esc close
        </div>
      </div>
    </div>
  );
}
