/**
 * CellNode — standalone output cell (table, image, HTML).
 * Content stored inline in .canvas JSON.
 * Double-click to edit markdown/html cells.
 */

import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { CellNode } from '../../../shared/types';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';

export function CellNodeComponent({ data }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#454545';

  return (
    <div className="skena-node" style={{ border: `1.5px solid ${borderColor}`, height: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', padding: 8 }}>
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      {node.format === 'markdown' && <MarkdownRenderer content={node.content} />}
      {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
      {node.format === 'html'     && <div dangerouslySetInnerHTML={{ __html: node.content }} />}
    </div>
  );
}
