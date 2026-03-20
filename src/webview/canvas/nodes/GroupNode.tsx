/**
 * GroupNode — semi-transparent colored background container.
 * Visual only; no logical grouping in JSON Canvas spec.
 */

import React from 'react';
import { NodeProps } from '@xyflow/react';
import { GroupNode } from '../../../shared/types';

export function GroupNodeComponent({ data }: NodeProps): JSX.Element {
  const node = data as unknown as GroupNode & { accentColor?: string };
  const bg = node.accentColor ? `${node.accentColor}18` : 'rgba(255,255,255,0.04)';
  const border = node.accentColor ?? 'rgba(255,255,255,0.12)';

  return (
    <div style={{ width: '100%', height: '100%', border: `1px dashed ${border}`, borderRadius: 8, background: bg, position: 'relative' }}>
      {node.label && (
        <span style={{ position: 'absolute', top: 8, left: 10, fontWeight: 600, fontSize: 11, color: node.accentColor ?? 'var(--vscode-foreground)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {node.label}
        </span>
      )}
    </div>
  );
}
