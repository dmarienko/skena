/**
 * Notebook renderer — displays parsed notebook cells.
 * Receives pre-parsed JSON from extension host (not raw .ipynb).
 * Handles: markdown cells, code cells with syntax highlight, base64 image outputs,
 * HTML outputs (pandas DataFrames etc.), and pin-to-canvas buttons.
 *
 * Pin buttons:
 *   • Per-output 📌 — pins a single output (hover to reveal)
 *   • Cell-level 📌 Pin all — appears when a cell has 2+ pinnable outputs;
 *     merges all outputs into one HTML blob so the CellNode shows table + chart together
 *
 * Pin fires `skena:pinCellOutput` CustomEvent → CanvasView creates a CellNode
 * (+ edge back to the notebook FileNode).
 */

import React, { useEffect } from 'react';
import { ParsedNotebook, ParsedCell, CellOutput } from '../../extension/notebook-parser';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeRenderer } from './CodeRenderer';
import { PlotlyRenderer } from './PlotlyRenderer';
import { useMarkdownConfig } from '../context/MarkdownConfigContext';

// - module-level: callback of the pin button currently under the mouse (for Alt+P hotkey)
let _hoveredPin: (() => void) | null = null;

interface NotebookRendererProps {
  /** - JSON.stringify of ParsedNotebook */
  parsedJson:   string;
  zoom:         string;
  /** - canvas node ID of the enclosing FileNode; attached to pinCellOutput so CanvasView can draw an edge */
  sourceNodeId: string;
}

export function NotebookRenderer({ parsedJson, zoom, sourceNodeId }: NotebookRendererProps): JSX.Element {
  const { notebookShowSource } = useMarkdownConfig();

  // - Alt+P hotkey support: fire whichever pin button the mouse is currently over
  useEffect(() => {
    const handler = () => { _hoveredPin?.(); };
    window.addEventListener('skena:altPin', handler);
    return () => window.removeEventListener('skena:altPin', handler);
  }, []);

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
          sourceNodeId={sourceNodeId}
        />
      ))}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// - dispatch pin event; CanvasView creates a CellNode (+ edge to sourceNodeId)
function pinOutput(content: string, format: 'html' | 'markdown' | 'image' | 'plotly', sourceNodeId: string) {
  window.dispatchEvent(new CustomEvent('skena:pinCellOutput', { detail: { content, format, sourceNodeId } }));
}

// - escape text for safe embedding in HTML (used for text/plain outputs)
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Converts all pinnable outputs of a cell into a single HTML string.
 * Images become <img> tags, HTML tables are inlined, plain text becomes <pre>.
 * The result is stored as format='html' in the CellNode.
 */
function cellOutputsToHtml(outputs: CellOutput[]): string {
  return outputs
    .map(out => {
      if (out.mimeType === 'image/png')
        return `<img src="data:image/png;base64,${out.data}" style="max-width:100%;display:block">`;
      if (out.mimeType === 'image/svg+xml')
        return `<img src="data:image/svg+xml;base64,${out.data}" style="max-width:100%;display:block">`;
      if (out.mimeType === 'text/html')
        return out.html;
      if (out.mimeType === 'text/plain')
        return `<pre style="font-size:10px;white-space:pre-wrap;margin:0">${escHtml(out.text)}</pre>`;
      // - plotly is interactive; can't be inlined into a static "pin all" HTML blob (has its own pin)
      if (out.mimeType === 'application/vnd.plotly.v1+json') return '';
      return '';  // - placeholders omitted from pinned content
    })
    .filter(Boolean)
    .join('\n');
}

// - outputs that can meaningfully be pinned (placeholders carry no renderable content)
function isPinnable(out: CellOutput): boolean {
  return out.mimeType !== 'placeholder';
}

// ─── components ───────────────────────────────────────────────────────────────

function PinButton({ onClick, title = 'Pin output to canvas' }: { onClick: () => void; title?: string }): JSX.Element {
  return (
    <button
      className="skena-notebook__pin-btn"
      title={title}
      onMouseEnter={() => { _hoveredPin = onClick; }}
      onMouseLeave={() => { if (_hoveredPin === onClick) _hoveredPin = null; }}
      onClick={e => { e.stopPropagation(); onClick(); }}
    >
      📌
    </button>
  );
}

function OutputBlock({
  out, sourceNodeId, showPin,
}: {
  out:          CellOutput;
  sourceNodeId: string;
  /** - false when a cell-level "Pin all" button is already shown */
  showPin:      boolean;
}): JSX.Element | null {
  if (out.mimeType === 'image/png') {
    const src = `data:image/png;base64,${out.data}`;
    return (
      <div className="skena-notebook__output">
        {showPin && <PinButton onClick={() => pinOutput(src, 'image', sourceNodeId)} />}
        <img src={src} alt="output" style={{ maxWidth: '100%' }} />
      </div>
    );
  }

  if (out.mimeType === 'image/svg+xml') {
    const src = `data:image/svg+xml;base64,${out.data}`;
    return (
      <div className="skena-notebook__output">
        {showPin && <PinButton onClick={() => pinOutput(src, 'image', sourceNodeId)} />}
        <img src={src} alt="output" style={{ maxWidth: '100%' }} />
      </div>
    );
  }

  if (out.mimeType === 'text/html') {
    return (
      <div className="skena-notebook__output">
        {showPin && <PinButton onClick={() => pinOutput(out.html, 'html', sourceNodeId)} />}
        <div className="skena-notebook__html-output" dangerouslySetInnerHTML={{ __html: out.html }} />
      </div>
    );
  }

  if (out.mimeType === 'application/vnd.plotly.v1+json') {
    return (
      <div className="skena-notebook__output" style={{ position: 'relative', height: 400 }}>
        {showPin && <PinButton onClick={() => pinOutput(out.json, 'plotly', sourceNodeId)} />}
        <PlotlyRenderer json={out.json} />
      </div>
    );
  }

  if (out.mimeType === 'text/plain') {
    return (
      <div className="skena-notebook__output">
        {showPin && <PinButton onClick={() => pinOutput(out.text, 'markdown', sourceNodeId)} />}
        <pre className="skena-notebook__text-output">{out.text}</pre>
      </div>
    );
  }

  if (out.mimeType === 'placeholder') {
    return (
      <div className="skena-notebook__output">
        <div className="skena-notebook__placeholder">{out.label}</div>
      </div>
    );
  }

  return null;
}

function CellBlock({
  cell, language, showSource, sourceNodeId,
}: {
  cell:         ParsedCell;
  language:     string;
  showSource:   boolean;
  sourceNodeId: string;
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

  // - "Pin all" is shown when 2+ outputs can be meaningfully pinned
  const pinnableOutputs = cell.outputs.filter(isPinnable);
  const showPinAll = pinnableOutputs.length >= 2;

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

      {/* - outputs block: relative container for the "Pin all" badge */}
      {hasOutput && (
        <div className="skena-notebook__outputs-group">
          {showPinAll && (
            <PinButton
              title="Pin all outputs to canvas as one cell"
              onClick={() => pinOutput(cellOutputsToHtml(pinnableOutputs), 'html', sourceNodeId)}
            />
          )}
          {cell.outputs.map((out, j) => (
            <OutputBlock key={j} out={out} sourceNodeId={sourceNodeId} showPin={!showPinAll} />
          ))}
        </div>
      )}
    </div>
  );
}
