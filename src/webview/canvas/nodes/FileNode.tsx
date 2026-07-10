/**
 * FileNode — renders a vault:// or project-relative file reference.
 * Dispatches to the correct renderer based on fileType.
 *
 * Re-render isolation layers (outermost → innermost):
 *
 *  FileNodeComponent  = memo(FileNodeInner)
 *    → only re-renders when data/id/selected change (node data or user selection)
 *    → does NOT consume ZoomLevelContext, so viewport zoom never reaches it
 *
 *  ZoomGate           = plain component (context consumer)
 *    → re-renders when ZoomLevelContext changes (zoom level threshold crossing)
 *    → tiny: just reads zoom, handles LOD cut, renders ScrollableContent shell
 *
 *  MemoContent        = memo(FileNodeContent)
 *    → only re-renders when fileType/content/resourceUri/zoom/baseUri change
 *    → zoom prop change causes a re-render here but NOT in MarkdownRenderer
 *
 *  MarkdownRenderer   = memo(MarkdownRendererInner)
 *    → only re-renders when content/baseUri change
 *    → zoom does NOT reach here: skips the full ReactMarkdown pipeline
 */

import React, { useCallback, memo } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { FileNode } from '../../../shared/types';
import { useFileContent } from '../../hooks/useFileContent';
import { useZoomLevel } from '../../hooks/useZoomLevel';
import { NodeHeader } from '../../components/NodeHeader';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { ScrollableContent } from '../../components/ScrollableContent';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { NotebookRenderer } from '../../renderers/NotebookRenderer';
import { CodeRenderer } from '../../renderers/CodeRenderer';
import { ImageRenderer } from '../../renderers/ImageRenderer';
import { useHeatmap } from '../../context/HeatmapContext';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from './defaultColors';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// ─── innermost: heavy content renderer (memoized by content identity) ─────────

interface ContentProps {
  fileType:     string;
  content:      string;
  resourceUri:  string | undefined;
  zoom:         string;
  baseUri?:     string;
  file:         string;
  truncated?:   boolean;
  totalSize?:   number;
  /** - pre-rendered HTML from extension host; bypasses ReactMarkdown entirely */
  html?:        string;
  /** - canvas node ID of the enclosing FileNode; forwarded to NotebookRenderer for pin-to-canvas */
  sourceNodeId: string;
}

const MemoContent = memo(function FileNodeContent({
  fileType, content, resourceUri, zoom, baseUri, file, truncated, totalSize, html, sourceNodeId,
}: ContentProps): JSX.Element {
  return (
    <>
      {fileType === 'markdown' && html && (
        // - pre-rendered by extension host (Node.js) — zero cost in the UI thread
        <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {fileType === 'markdown' && !html && <MarkdownRenderer content={content} baseUri={baseUri} />}
      {fileType === 'notebook' && <NotebookRenderer parsedJson={content} zoom={zoom} sourceNodeId={sourceNodeId} />}
      {(fileType === 'python' || fileType === 'yaml') && (
        <CodeRenderer content={content} language={fileType === 'yaml' ? 'yaml' : 'python'} />
      )}
      {fileType === 'image' && <ImageRenderer resourceUri={resourceUri ?? ''} />}
      {fileType !== 'markdown' && fileType !== 'notebook' && fileType !== 'python' &&
       fileType !== 'yaml' && fileType !== 'image' && (
        <div className="skena-unknown">No preview available</div>
      )}
      {/* - truncation notice: file was too large to send fully */}
      {truncated && totalSize && (
        <div style={{
          marginTop: 8, padding: '5px 8px',
          background:   'rgba(245,158,11,0.12)',
          border:       '1px solid rgba(245,158,11,0.35)',
          borderRadius: 4, fontSize: 11,
          color:        'rgba(245,158,11,0.9)',
          display:      'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚠ Preview truncated — showing first 200 KB of {(totalSize / 1024 / 1024).toFixed(1)} MB</span>
          <button
            onClick={e => { e.stopPropagation(); vscodePostMessage({ type: 'openFile', uri: file }); }}
            style={{
              marginLeft: 'auto', padding: '2px 8px',
              background:   'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.5)',
              borderRadius: 3, cursor: 'pointer', color: 'inherit', fontSize: 11,
            }}
          >Open full file</button>
        </div>
      )}
    </>
  );
});

// ─── middle: zoom-aware LOD gate (the ONLY ZoomLevelContext consumer here) ─────
//
// By isolating useZoomLevel() in this thin component, FileNodeInner is NOT a
// context consumer. Zoom level changes cause only ZoomGate to re-render — NOT
// the full FileNodeInner tree (NodeHeader, handles, callbacks, etc.).

interface ZoomGateProps {
  id:           string;
  status:       string;
  content:      string;
  fileType:     string;
  resourceUri:  string | undefined;
  error:        string | undefined;
  truncated?:   boolean;
  totalSize?:   number;
  file:         string;
  html?:        string;
  sourceNodeId: string;
}

function ZoomGate({ id, status, content, fileType, resourceUri, error, truncated, totalSize, file, html, sourceNodeId }: ZoomGateProps): JSX.Element {
  const zoom = useZoomLevel();

  // - LOD: hide content only at 'minimal' zoom (< 0.3) where nodes are pixel-sized.
  // - 'overview' (0.3–0.8) now stays visible so .md file nodes behave like TextNodes.
  // - The original 'overview' hide was a guard against ReactMarkdown re-parses on
  // - zoom-in. Markdown files now use pre-rendered HTML (dangerouslySetInnerHTML) so
  // - there is no expensive parse to protect. will-change:transform + content-visibility
  // - handle GPU and layout costs; hiding at overview buys nothing.
  const hidden = zoom === 'minimal';

  return (
    <ScrollableContent scrollKey={id} hidden={hidden} contentLoaded={status === 'loaded'}>
      {status === 'loading' && <div className="skena-loading">Loading...</div>}
      {status === 'error'   && <div className="skena-error">{error === 'TOO_LARGE' ? 'File too large to preview' : `Error: ${error}`}</div>}
      {status === 'loaded'  && (
        <MemoContent
          fileType={fileType} content={content} resourceUri={resourceUri}
          zoom={zoom} baseUri={file} file={file}
          truncated={truncated} totalSize={totalSize} html={html}
          sourceNodeId={sourceNodeId}
        />
      )}
    </ScrollableContent>
  );
}

// ─── outer: full node shell (NOT a context consumer) ──────────────────────────

function FileNodeInner({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as FileNode & { accentColor?: string };
  const { visible: hmVisible, nodeGlow } = useHeatmap();
  const hmNode = hmVisible ? nodeGlow.get(data.id as string) : undefined;
  const selectedStyle = useSelectedStyle(selected);
  const bw = useZoomInvariantBorderWidth(1.5);
  const { status, content, fileType, resourceUri, error, truncated, totalSize, html } = useFileContent(node.file);

  const openInEditor = useCallback(() => {
    vscodePostMessage({ type: 'openFile', uri: node.file });
  }, [node.file]);

  const onCmdClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      openInEditor();
    }
  }, [openInEditor]);

  const borderColor = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.file;

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      className="skena-node skena-node--file"
      style={{
        border:        `${bw}px solid ${borderColor}`,
        height:        '100%',
        display:       'flex',
        flexDirection: 'column',
        borderRadius:  6,
        overflow:      'hidden',
        // - heatmap glow overrides: filter (drop-shadow), borderColor, opacity
        ...(hmNode ? {
          filter:      hmNode.glowFilter,
          borderColor: hmNode.borderColor,
          opacity:     hmNode.opacity,
        } : {}),
        // - sci-fi focus ring
        ...selectedStyle,
      }}
      onClick={onCmdClick}
    >
      <NodeResizer
        minWidth={120} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />

      <NodeHeader
        fileType={fileType}
        uri={node.file}
        content={content}
        accentColor={borderColor}
        onOpen={openInEditor}
      />

      <ZoomGate
        id={id} status={status} content={content} fileType={fileType}
        resourceUri={resourceUri} error={error}
        truncated={truncated} totalSize={totalSize} file={node.file} html={html}
        sourceNodeId={id}
      />
    </div>
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}

// - memo: React Flow may re-render all visible nodes on store changes (edge
// - updates, another node resize, etc.). With memo, FileNodeComponent skips
// - re-rendering when its own data/id/selected props are unchanged.
// - NOTE: FileNodeInner does NOT call useZoomLevel(), so it is not a
// - ZoomLevelContext consumer — viewport zoom never causes it to re-render.
export const FileNodeComponent = memo(FileNodeInner);
