/**
 * A plotly figure inside a stacked (html) cell output: a placeholder div at the figure's place, its JSON
 * as a base64 data URI in `data-figure`. Base64 keeps the JSON out of HTML escaping, and the data URI
 * keeps it out of canvas search and the HTML size limit, which already skip `data:…;base64,` payloads.
 * The host writes it (jupyter/output.ts), the webview draws a chart into it (CellNode), the HTML export
 * turns it into a page figure. No vscode or DOM import.
 */

export const PLOTLY_PART_CLASS = 'skena-plotly-part';
const DATA_PREFIX = 'data:application/json;base64,';
// - the placeholder exactly as plotlyPartHtml writes it
const PART = /<div class="skena-plotly-part[^"]*" data-figure="data:application\/json;base64,([A-Za-z0-9+/=]*)"><\/div>/g;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  // - in chunks: String.fromCharCode with a whole large figure as arguments overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** - the placeholder of one figure; `nowheel nodrag` give the chart the wheel and the drag */
export function plotlyPartHtml(figureJson: string): string {
  return `<div class="${PLOTLY_PART_CLASS} nowheel nodrag" data-figure="${DATA_PREFIX}${toBase64(figureJson)}"></div>`;
}

/** - the figure JSON a placeholder's data-figure holds, or null when it is not one */
export function plotlyPartFigure(dataFigure: string | null | undefined): string | null {
  if (!dataFigure?.startsWith(DATA_PREFIX)) return null;
  try { return fromBase64(dataFigure.slice(DATA_PREFIX.length)); } catch { return null; }
}

/** - every placeholder of `html` replaced by `draw(figureJson, k)`, k counting from 0 in order */
export function replacePlotlyParts(html: string, draw: (figureJson: string, k: number) => string): string {
  let k = 0;
  return html.replace(PART, (_, b64: string) => draw(fromBase64(b64), k++));
}

/** - the figures of `html`'s placeholders, in order */
export function plotlyPartFigures(html: string): string[] {
  const out: string[] = [];
  replacePlotlyParts(html, json => { out.push(json); return ''; });
  return out;
}
