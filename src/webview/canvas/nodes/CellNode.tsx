/**
 * CellNode — standalone output cell (table, image, HTML).
 * Content stored inline in .canvas JSON.
 * Double-click to edit markdown/html cells.
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { CellNode } from '../../../shared/types';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';

export function CellNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#454545';

  return (
    <div className="skena-node" style={{ border: `1.5px solid ${borderColor}`, height: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', display: 'flex', flexDirection: 'column' }}>
      <NodeResizer
        minWidth={100} minHeight={60}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <ScrollableContent>
        {node.format === 'markdown' && <MarkdownRenderer content={node.content} />}
        {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {node.format === 'html'     && <div dangerouslySetInnerHTML={{ __html: node.content }} />}
      </ScrollableContent>
    </div>
  );
}
