import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Popover input for a section title. Enter commits, Escape cancels, blur commits. */
export function TitleEditor({ anchor, initial, onCommit, onClose }: {
  anchor: DOMRect;
  initial: string;
  onCommit: (title: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  // - set once, by Enter, Escape or the first blur: closing unmounts the input, which blurs it,
  //   so every later blur is a no-op and the edit commits exactly once (never at all on Escape)
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(value); onClose(); };
  return createPortal(
    <input ref={ref} className="nodrag" value={value} placeholder="section title"
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done.current = true; onClose(); } e.stopPropagation(); }}
      onBlur={commit}
      style={{ position: 'fixed', left: anchor.right + 6, top: anchor.top, zIndex: 1000, width: 220, padding: '5px 8px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12, color: 'var(--sk-text1)', background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', borderRadius: 8, outline: 'none' }} />,
    document.body,
  );
}
