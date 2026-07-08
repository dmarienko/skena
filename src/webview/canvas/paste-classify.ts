// - pure clipboard classifier for paste-to-node; no DOM, no vscode — unit-testable standalone.
// - priority per spec: image > html > uri-list > text (yy-internal / url / path / plain).

export interface ClipboardInput {
  hasImage:   boolean;
  html:       string;          // - text/html flavor, '' if absent
  uriList:    string;          // - raw text/uri-list, '' if absent
  text:       string;          // - text/plain flavor, '' if absent
  yySnapshot: string | null;   // - OS clipboard text captured at last yy, null if never
}

export type PasteAction =
  | { kind: 'cell-image' }
  | { kind: 'cell-html'; html: string }
  | { kind: 'files'; uris: string[] }
  | { kind: 'internal' }
  | { kind: 'link'; url: string }
  | { kind: 'verify-path'; raw: string }
  | { kind: 'text'; text: string }
  | { kind: 'cell-plotly'; json: string }
  | { kind: 'figure-repr'; text: string }
  | { kind: 'none' };

const isSingleLine = (s: string) => !/\r|\n/.test(s);
const isUrl  = (s: string) => /^https?:\/\/\S+$/.test(s);
// - permissive: spaces allowed — host-side existence check filters false positives
const isPath = (s: string) => /^(file:\/\/|\/|~\/)/.test(s);

// - a plotly figure spec: a single JSON object with a `data` array (+ usually `layout`)
function asPlotlyFigure(s: string): string | null {
  if (!s.startsWith('{')) return null;   // - cheap pre-filter before JSON.parse
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && Array.isArray(o.data)) return s;
  } catch { /* - not JSON */ }
  return null;
}

// - return the substring from openIdx spanning balanced open/close brackets, respecting JS string literals.
function sliceBalanced(s: string, openIdx: number, open: string, close: string): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
  }
  return null;   // - unbalanced
}

// - extract {data, layout} JSON from a pasted plotly HTML export's Plotly.newPlot("id", [data], {layout}, ...) call
function extractPlotlyFromHtml(s: string): string | null {
  const marker = 'Plotly.newPlot(';
  const m = s.indexOf(marker);
  if (m < 0) return null;
  const after = m + marker.length;
  const dataStart = s.indexOf('[', after);   // - arg1 is the element id string; first [ is the data array
  if (dataStart < 0) return null;
  const dataStr = sliceBalanced(s, dataStart, '[', ']');
  if (!dataStr) return null;
  let data: unknown;
  try { data = JSON.parse(dataStr); } catch { return null; }
  if (!Array.isArray(data)) return null;
  let layout: unknown = {};
  const layoutStart = s.indexOf('{', dataStart + dataStr.length);
  if (layoutStart >= 0) {
    const layoutStr = sliceBalanced(s, layoutStart, '{', '}');
    if (layoutStr) { try { layout = JSON.parse(layoutStr); } catch { /* - keep {} */ } }
  }
  return JSON.stringify({ data, layout });
}

// - a Python plotly repr (FigureWidget({...}) / Figure({...}) / go.Figure({...})).
// - NOT figure data: numpy truncates arrays with `...`, so it can't be rendered — paste hints instead.
function isPythonFigureRepr(s: string): boolean {
  return /^(go\.)?Figure(Widget)?\(\s*\{/.test(s);
}

export function classifyClipboard(input: ClipboardInput): PasteAction {
  const trimmed = input.text.trim();

  if (input.hasImage) return { kind: 'cell-image' };

  // - browser-URL guard: copied links often carry anchor markup in text/html;
  // - the single-line URL plain flavor is the truer intent
  if (input.html.trim()) {
    if (isSingleLine(trimmed) && isUrl(trimmed)) return { kind: 'link', url: trimmed };
    const embedded = extractPlotlyFromHtml(input.html);
    if (embedded) return { kind: 'cell-plotly', json: embedded };
    return { kind: 'cell-html', html: input.html };
  }

  if (input.uriList.trim()) {
    const uris = input.uriList.split(/\r?\n/).map(u => u.trim()).filter(u => u && !u.startsWith('#'));
    if (uris.length > 0) return { kind: 'files', uris };
  }

  if (trimmed) {
    if (input.yySnapshot !== null && input.text === input.yySnapshot) return { kind: 'internal' };
    const embeddedText = extractPlotlyFromHtml(trimmed);
    if (embeddedText) return { kind: 'cell-plotly', json: embeddedText };
    const plotly = asPlotlyFigure(trimmed);
    if (plotly) return { kind: 'cell-plotly', json: plotly };
    if (isPythonFigureRepr(trimmed)) return { kind: 'figure-repr', text: input.text };
    if (isSingleLine(trimmed)) {
      if (isUrl(trimmed))  return { kind: 'link', url: trimmed };
      if (isPath(trimmed)) return { kind: 'verify-path', raw: trimmed };
    }
    return { kind: 'text', text: input.text };
  }

  return { kind: 'none' };
}
