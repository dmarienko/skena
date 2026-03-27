/**
 * Notebook renderer — displays parsed notebook cells.
 * Receives pre-parsed JSON from extension host (not raw .ipynb).
 * Handles: markdown cells, code cells with syntax highlight, base64 image outputs.
 */

import React from 'react';
import { ParsedNotebook, ParsedCell } from '../../extension/notebook-parser';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeRenderer } from './CodeRenderer';
import { useMarkdownConfig } from '../context/MarkdownConfigContext';

interface NotebookRendererProps {
  /** - JSON.stringify of ParsedNotebook */
  parsedJson: string;
  zoom: string;
}

export function NotebookRenderer({ parsedJson, zoom }: NotebookRendererProps): JSX.Element {
  const { notebookShowSource } = useMarkdownConfig();

  let notebook: ParsedNotebook;
  try {
    notebook = JSON.parse(parsedJson) as ParsedNotebook;
  } catch {
    return <div className="skena-error">Invalid notebook data</div>;
  }

  return (
    <div className="skena-notebook">
      {notebook.cells.map((cell, i) => (
        <CellBlock
          key={i}
          cell={cell}
          language={notebook.languageName}
          showSource={notebookShowSource ?? false}
        />
      ))}
    </div>
  );
}

function CellBlock({
  cell, language, showSource,
}: {
  cell: ParsedCell;
  language: string;
  showSource: boolean;
}): JSX.Element | null {
  // - markdown cells always visible
  if (cell.type === 'markdown') {
    return (
      <div className="skena-notebook__cell">
        <MarkdownRenderer content={cell.source} />
      </div>
    );
  }

  // - code cells: skip entirely if there's no output AND source is hidden
  const hasOutput = cell.outputs.length > 0;
  if (!showSource && !hasOutput) return null;

  return (
    <div className="skena-notebook__cell">
      {/* - source block: only shown when showSource is true */}
      {showSource && (
        <div className="skena-notebook__code-prompt">
          <span className="skena-notebook__execution-count">
            {cell.executionCount != null ? `[${cell.executionCount}]` : '[ ]'}
          </span>
          <CodeRenderer content={cell.source} language={language} />
        </div>
      )}

      {/* - outputs: always shown when present */}
      {cell.outputs.map((out, j) => (
        <div key={j} className="skena-notebook__output">
          {out.mimeType === 'image/png' && (
            <img src={`data:image/png;base64,${out.data}`} alt="output" style={{ maxWidth: '100%' }} />
          )}
          {out.mimeType === 'image/svg+xml' && (
            <img src={`data:image/svg+xml;base64,${out.data}`} alt="output" style={{ maxWidth: '100%' }} />
          )}
          {out.mimeType === 'text/plain' && (
            <pre className="skena-notebook__text-output">{out.text}</pre>
          )}
          {out.mimeType === 'placeholder' && (
            <div className="skena-notebook__placeholder">{out.label}</div>
          )}
        </div>
      ))}
    </div>
  );
}
