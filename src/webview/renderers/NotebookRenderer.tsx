/**
 * Notebook renderer — displays parsed notebook cells.
 * Receives pre-parsed JSON from extension host (not raw .ipynb).
 * Handles: markdown cells, code cells with syntax highlight, base64 image outputs.
 */

import React from 'react';
import { ParsedNotebook, ParsedCell } from '../../extension/notebook-parser';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeRenderer } from './CodeRenderer';

interface NotebookRendererProps {
  /** - JSON.stringify of ParsedNotebook */
  parsedJson: string;
  zoom: string;
}

export function NotebookRenderer({ parsedJson, zoom }: NotebookRendererProps): JSX.Element {
  let notebook: ParsedNotebook;
  try {
    notebook = JSON.parse(parsedJson) as ParsedNotebook;
  } catch {
    return <div className="skena-error">Invalid notebook data</div>;
  }

  // - at 'reading' zoom: show all cells
  // - at 'detail' zoom: same (full)
  return (
    <div className="skena-notebook">
      {notebook.cells.map((cell, i) => (
        <CellBlock key={i} cell={cell} language={notebook.languageName} />
      ))}
    </div>
  );
}

function CellBlock({ cell, language }: { cell: ParsedCell; language: string }): JSX.Element {
  return (
    <div className="skena-notebook__cell">
      {cell.type === 'markdown' && <MarkdownRenderer content={cell.source} />}

      {cell.type === 'code' && (
        <>
          <div className="skena-notebook__code-prompt">
            <span className="skena-notebook__execution-count">
              {cell.executionCount != null ? `[${cell.executionCount}]` : '[ ]'}
            </span>
            <CodeRenderer content={cell.source} language={language} />
          </div>
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
        </>
      )}
    </div>
  );
}
