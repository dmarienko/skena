/**
 * FileNode — renders a vault:// or project-relative file reference.
 * Dispatches to the correct renderer based on fileType.
 * Handles LOD switching via useZoomLevel.
 */

import React, { useCallback } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { FileNode } from '../../../shared/types';
import { useFileContent } from '../../hooks/useFileContent';
import { useZoomLevel } from '../../hooks/useZoomLevel';
import { NodeHeader } from '../../components/NodeHeader';
import { ScrollableContent } from '../../components/ScrollableContent';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { NotebookRenderer } from '../../renderers/NotebookRenderer';
import { CodeRenderer } from '../../renderers/CodeRenderer';
import { ImageRenderer } from '../../renderers/ImageRenderer';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function FileNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as FileNode & { accentColor?: string };
  const { status, content, fileType, resourceUri, error } = useFileContent(node.file);
  const zoom = useZoomLevel();

  const openInEditor = useCallback(() => {
    vscodePostMessage({ type: 'openFile', uri: node.file });
  }, [node.file]);

  const onCmdClick = useCallback((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      openInEditor();
    }
  }, [openInEditor]);

  const borderColor = node.accentColor ?? '#454545';

  return (
    <div
      className="skena-node skena-node--file"
      style={{ border: `1.5px solid ${borderColor}`, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden' }}
      onClick={onCmdClick}
    >
      <NodeResizer
        minWidth={120} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      {/* - connection handles on all 4 sides */}
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <NodeHeader
        fileType={fileType}
        uri={node.file}
        content={content}
        accentColor={borderColor}
        onOpen={openInEditor}
      />

      {/* - LOD: minimal / overview → title only (header already shown above) */}
      {(zoom === 'minimal' || zoom === 'overview') ? null : (
        <ScrollableContent>
          {status === 'loading' && <div className="skena-loading">Loading...</div>}
          {status === 'error'   && <div className="skena-error">{error === 'TOO_LARGE' ? 'File too large to preview' : `Error: ${error}`}</div>}
          {status === 'loaded'  && renderContent(fileType, content, resourceUri, zoom, node.file)}
        </ScrollableContent>
      )}
    </div>
  );
}

function renderContent(
  fileType: string,
  content: string,
  resourceUri: string | undefined,
  zoom: string,
  baseUri?: string,
): JSX.Element {
  switch (fileType) {
    case 'markdown': return <MarkdownRenderer content={content} baseUri={baseUri} />;
    case 'notebook': return <NotebookRenderer parsedJson={content} zoom={zoom} />;
    case 'python':
    case 'yaml':     return <CodeRenderer content={content} language={fileType === 'yaml' ? 'yaml' : 'python'} />;
    case 'image':    return <ImageRenderer resourceUri={resourceUri ?? ''} />;
    default:         return <div className="skena-unknown">No preview available</div>;
  }
}
