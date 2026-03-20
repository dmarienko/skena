/**
 * ImageRenderer — renders images from vscode-resource:// URIs.
 * The extension host converts raw file paths to webview-safe URIs via
 * webview.asWebviewUri() before sending to the webview.
 */

import React from 'react';

interface ImageRendererProps {
  resourceUri: string;
}

export function ImageRenderer({ resourceUri }: ImageRendererProps): JSX.Element {
  if (!resourceUri) {
    return <div className="skena-error">Image URI not available</div>;
  }

  return (
    <img
      src={resourceUri}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
    />
  );
}
