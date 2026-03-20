/**
 * TextNode — inline markdown text node.
 * Double-click to edit; single-click to select.
 */

import React, { useState, useCallback } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { TextNode } from '../../../shared/types';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function TextNodeComponent({ data, id }: NodeProps): JSX.Element {
  const node = data as unknown as TextNode & { accentColor?: string };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);

  const borderColor = node.accentColor ?? '#454545';

  const commitEdit = useCallback(() => {
    setEditing(false);
    if (draft !== node.text) {
      // - save updated canvas with new text — bubble up via postMessage
      // - for now emit a custom event; CanvasView handles it
      window.dispatchEvent(new CustomEvent('skena:nodeTextEdit', { detail: { id, text: draft } }));
    }
  }, [draft, node.text, id]);

  return (
    <div
      className="skena-node" style={{ border: `1.5px solid ${borderColor}`, height: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', padding: 8 }}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      {editing ? (
        <textarea
          style={{ width: '100%', height: '100%', background: 'transparent', color: 'var(--vscode-foreground)', border: 'none', outline: 'none', resize: 'none', fontFamily: 'var(--vscode-editor-font-family)', fontSize: 13 }}
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setDraft(node.text); } }}
        />
      ) : (
        <MarkdownRenderer content={node.text} />
      )}
    </div>
  );
}
