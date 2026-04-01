/**
 * Jupyter notebook parser — runs in extension host (Node.js) only.
 * Parses .ipynb JSON, extracts cells and base64 image outputs.
 * Result is serialized and sent to webview via message protocol.
 */

export type CellType = 'markdown' | 'code' | 'raw';

export interface OutputImage {
  mimeType: 'image/png' | 'image/svg+xml';
  /** - base64 encoded data (no data URI prefix) */
  data: string;
}

export interface OutputText {
  mimeType: 'text/plain';
  text: string;
}

export interface OutputHtml {
  mimeType: 'text/html';
  html: string;
}

export interface OutputPlaceholder {
  mimeType: 'placeholder';
  label: string;
}

export type CellOutput = OutputImage | OutputText | OutputHtml | OutputPlaceholder;

export interface ParsedCell {
  type: CellType;
  source: string;
  outputs: CellOutput[];
  executionCount?: number | null;
}

export interface ParsedNotebook {
  kernelName: string;
  languageName: string;
  cellCount: number;
  cells: ParsedCell[];
}

interface RawNotebook {
  nbformat: number;
  metadata?: {
    kernelspec?: { display_name?: string; name?: string; language?: string };
    language_info?: { name?: string };
  };
  cells?: RawCell[];
}

interface RawCell {
  cell_type: string;
  source: string | string[];
  outputs?: RawOutput[];
  execution_count?: number | null;
}

interface RawOutput {
  output_type: string;
  data?: Record<string, string | string[]>;
  text?: string | string[];
  ename?: string;
  evalue?: string;
}

function joinSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source;
}

function parseOutputs(rawOutputs: RawOutput[]): CellOutput[] {
  const outputs: CellOutput[] = [];

  for (const out of rawOutputs) {
    if (out.output_type === 'error') {
      outputs.push({
        mimeType: 'text/plain',
        text: `${out.ename ?? 'Error'}: ${out.evalue ?? ''}`,
      });
      continue;
    }

    if (out.output_type === 'stream') {
      const text = joinSource(out.text ?? '');
      if (text) outputs.push({ mimeType: 'text/plain', text });
      continue;
    }

    // - display_data or execute_result
    const data = out.data ?? {};

    // - prefer PNG, then SVG
    if (data['image/png']) {
      outputs.push({
        mimeType: 'image/png',
        data: joinSource(data['image/png']).replace(/\s/g, ''),
      });
      continue;
    }

    if (data['image/svg+xml']) {
      outputs.push({
        mimeType: 'image/svg+xml',
        data: btoa(joinSource(data['image/svg+xml'])),
      });
      continue;
    }

    // - text/html: pandas DataFrames, rich display objects, etc.
    if (data['text/html']) {
      outputs.push({ mimeType: 'text/html', html: joinSource(data['text/html']) });
      continue;
    }

    if (data['text/plain']) {
      outputs.push({ mimeType: 'text/plain', text: joinSource(data['text/plain']) });
      continue;
    }

    // - plotly, widgets, etc. — show placeholder
    const knownInteractive = ['application/vnd.plotly.v1+json', 'application/vnd.jupyter.widget-view+json'];
    const interactiveMime = knownInteractive.find(m => m in data);
    if (interactiveMime) {
      outputs.push({ mimeType: 'placeholder', label: `[interactive: ${interactiveMime}]` });
    }
  }

  return outputs;
}

export function parseNotebook(json: string): ParsedNotebook {
  const raw = JSON.parse(json) as RawNotebook;

  const kernelName = raw.metadata?.kernelspec?.display_name
    ?? raw.metadata?.kernelspec?.name
    ?? 'unknown';
  const languageName = raw.metadata?.language_info?.name
    ?? raw.metadata?.kernelspec?.language
    ?? 'python';

  const cells: ParsedCell[] = (raw.cells ?? []).map(cell => ({
    type:           (cell.cell_type as CellType) ?? 'raw',
    source:         joinSource(cell.source),
    outputs:        parseOutputs(cell.outputs ?? []),
    executionCount: cell.execution_count,
  }));

  return {
    kernelName,
    languageName,
    cellCount: cells.length,
    cells,
  };
}
