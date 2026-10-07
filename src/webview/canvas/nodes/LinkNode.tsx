/**
 * LinkNode — external URL node.
 * Shows favicon + URL; a YouTube video shows its thumbnail. Click opens the URL in the browser.
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { LinkNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, ZOOM_WIDTH_CLASS, focusRingStyle, useZoomVars, zoomInvariantWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';
import { youtubeId, youtubeThumbnail } from '../../../shared/youtube';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`;
  } catch {
    return '';
  }
}

function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function LinkNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as LinkNode & { accentColor?: string };
  const selectedStyle = focusRingStyle(selected);
  const bw = zoomInvariantWidth(1.5);
  const zoomVars = useZoomVars();
  const borderColor = nodeBorderColor('link', node.accentColor);
  const favicon = getFaviconUrl(node.url);

  const open = () => vscodePostMessage({ type: 'openFile', uri: node.url });
  const videoId = youtubeId(node.url);

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      className={`skena-node ${ZOOM_WIDTH_CLASS}`}
      style={{
        ...zoomVars,
        border:        `${bw} solid ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        background:    'var(--vscode-editorWidget-background)',
        padding:       '8px 10px',
        cursor:        'pointer',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
        // - sci-fi focus ring
        ...selectedStyle,
      }}
      onClick={open}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {favicon && <img src={favicon} alt="" width={16} height={16} style={{ flexShrink: 0 }} />}
        <span style={{ fontSize: 11, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getHostname(node.url)}
        </span>
      </div>
      {videoId ? (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: 4, overflow: 'hidden', background: '#000' }}>
          <img
            src={youtubeThumbnail(videoId)} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <svg viewBox="0 0 68 48" width={68} height={48} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.9 }}>
            <path d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4a8.6 8.6 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.6 8.6 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.6 8.6 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#f00" />
            <path d="M45 24 27 14v20z" fill="#fff" />
          </svg>
        </div>
      ) : (
        <div style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.85 }}>{node.url}</div>
      )}
    </div>
    <NodeResizer
      minWidth={100} minHeight={60}
      isVisible={selected}
      onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
        detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
      }))}
    />
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
