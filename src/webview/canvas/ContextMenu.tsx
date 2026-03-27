/**
 * ContextMenu — right-click context menu for the canvas.
 * Renders at fixed screen coords, closes on outside click or Escape.
 *
 * IMPORTANT: outside-click listener is registered ONCE on mount (empty deps) and
 * removed on unmount via the effect cleanup.  Using [onClose] as a dep was broken:
 *   - React creates a new onClose arrow on every CanvasView render
 *   - the dep change triggered cleanup → clearTimeout (before addEventListener ran) →
 *     new timeout → repeat → addEventListener was NEVER called in practice
 *   - worse: the cleanup returned from inside setTimeout was ignored by JS, so any
 *     handlers that DID fire were never removed; stale handlers with menuRef.current=null
 *     would then fire on the NEXT open and close the menu before click fired.
 *
 * Fix: keep onClose in a ref (always current, no re-renders needed), register the
 * mousedown handler exactly once with capture:true so ReactFlow's stopPropagation
 * on the canvas cannot prevent it from firing.
 */

import React, { useRef, useEffect, useState } from 'react';

interface Props {
  screenX:       number;
  screenY:       number;
  selectedCount: number;
  hasClipboard:  boolean;
  onClose:           () => void;
  onAddText:         () => void;
  onAddUrl:          (url: string) => void;
  onSearch:          () => void;
  onCopy:            () => void;
  onPaste:           () => void;
  onMoveToSubCanvas: () => void;
}

function MenuItem({ icon, label, onClick, disabled = false }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        8,
        width:      '100%',
        padding:    '6px 14px',
        background: hover && !disabled ? 'var(--vscode-list-hoverBackground)' : 'none',
        border:     'none',
        color:      disabled ? 'var(--vscode-disabledForeground)' : 'var(--vscode-foreground)',
        cursor:     disabled ? 'default' : 'pointer',
        fontSize:   13,
        textAlign:  'left',
        opacity:    disabled ? 0.45 : 1,
      }}
    >
      <span className={`codicon codicon-${icon}`} style={{ fontSize: 14, flexShrink: 0, width: 16 }} />
      {label}
    </button>
  );
}

function Divider(): JSX.Element {
  return (
    <div style={{
      height:     1,
      background: 'var(--vscode-menu-separatorBackground, rgba(255,255,255,0.12))',
      margin:     '4px 0',
    }} />
  );
}

export function ContextMenu({
  screenX, screenY,
  selectedCount, hasClipboard,
  onClose, onAddText, onAddUrl, onSearch, onCopy, onPaste, onMoveToSubCanvas,
}: Props): JSX.Element {
  const menuRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // - keep latest callbacks in refs so effects don't need them as deps
  const onCloseRef  = useRef(onClose);
  const urlModeRef  = useRef(false);
  onCloseRef.current = onClose;

  const [urlMode,  setUrlMode]  = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState('');

  // - sync urlMode into ref so the Escape handler below (which runs once) always sees current value
  urlModeRef.current = urlMode;

  // - outside-click: register ONCE on mount, remove on unmount
  // - capture:true fires before ReactFlow's stopPropagation on the canvas pane
  // - 50 ms delay so the right-click mousedown that opened the menu doesn't immediately close it
  useEffect(() => {
    let handler: ((e: MouseEvent) => void) | null = null;

    const t = setTimeout(() => {
      handler = (e: MouseEvent) => {
        if (!menuRef.current?.contains(e.target as Node)) onCloseRef.current();
      };
      document.addEventListener('mousedown', handler, true);
    }, 50);

    return () => {
      clearTimeout(t);
      if (handler) document.removeEventListener('mousedown', handler, true);
    };
  }, []); // - empty deps: registers once on mount, cleaned up on unmount

  // - Escape: collapse URL input first, then close the whole menu
  // - re-runs only when urlMode changes (onClose via ref, so no spurious re-registrations)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (urlModeRef.current) {
        setUrlMode(false); setUrlValue(''); setUrlError('');
      } else {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []); // - empty deps: refs keep values current

  useEffect(() => { if (urlMode) inputRef.current?.focus(); }, [urlMode]);

  const commitUrl = () => {
    const v = urlValue.trim();
    if (!v) { setUrlError('URL cannot be empty'); return; }
    try { new URL(v); }
    catch { setUrlError('Enter a valid URL (https://…)'); return; }
    onAddUrl(v);
    onClose();
  };

  // - keep menu inside viewport
  const W = 230;
  const left = Math.min(screenX, window.innerWidth  - W - 8);
  const top  = Math.min(screenY, window.innerHeight - 300);

  return (
    <div
      ref={menuRef}
      style={{
        position:     'fixed',
        left,
        top,
        zIndex:       99999,
        minWidth:     W,
        background:   'var(--vscode-menu-background, var(--vscode-editorWidget-background))',
        border:       '1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, rgba(255,255,255,0.18)))',
        borderRadius: 6,
        boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
        padding:      '4px 0',
        userSelect:   'none',
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <MenuItem icon="edit"   label="Add text note"    onClick={() => { onAddText(); onClose(); }} />
      {urlMode ? (
        <div style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              ref={inputRef}
              value={urlValue}
              onChange={e => { setUrlValue(e.target.value); setUrlError(''); }}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitUrl(); }}
              placeholder="https://…"
              style={{
                flex:         1,
                padding:      '4px 8px',
                background:   'var(--vscode-input-background)',
                color:        'var(--vscode-input-foreground)',
                border:       `1px solid ${urlError ? '#e05252' : 'var(--vscode-input-border, rgba(255,255,255,0.2))'}`,
                borderRadius: 4,
                fontSize:     12,
                outline:      'none',
              }}
            />
            <button
              onClick={commitUrl}
              style={{
                padding:      '4px 10px',
                background:   'var(--vscode-button-background)',
                color:        'var(--vscode-button-foreground)',
                border:       'none',
                borderRadius: 4,
                cursor:       'pointer',
                fontSize:     12,
              }}
            >Add</button>
          </div>
          {urlError && <span style={{ fontSize: 11, color: '#e05252' }}>{urlError}</span>}
        </div>
      ) : (
        <MenuItem icon="link"   label="Add URL…"          onClick={() => setUrlMode(true)} />
      )}
      <MenuItem icon="search" label="Add from search…"  onClick={() => { onSearch(); onClose(); }} />

      <Divider />
      <MenuItem icon="copy"   label="Copy"              onClick={() => { onCopy();  onClose(); }} disabled={selectedCount === 0} />
      <MenuItem icon="clippy" label="Paste"             onClick={() => { onPaste(); onClose(); }} disabled={!hasClipboard} />

      {selectedCount >= 2 && (
        <>
          <Divider />
          <MenuItem icon="symbol-namespace" label="Move to sub-canvas…" onClick={() => { onMoveToSubCanvas(); onClose(); }} />
        </>
      )}
    </div>
  );
}
