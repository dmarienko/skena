import type { CollectedOutput } from './protocol';
import { renderStream } from './protocol';
import { renderWidget } from './widgets';
import { capOutputHtml, capOutputText } from '../../shared/outputCap';

export type OutputFormat = 'markdown' | 'image' | 'html' | 'plotly';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// - basic + bright ANSI foreground palette (dark-terminal-ish); enough for tracebacks / colorama
const ANSI_FG: Record<number, string> = {
  30: '#5c6370', 31: '#e06c75', 32: '#98c379', 33: '#d19a66', 34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#dcdfe4',
  90: '#7f848e', 91: '#ff7a85', 92: '#b5e890', 93: '#e5c07b', 94: '#7fb6ff', 95: '#e29bef', 96: '#68d9e6', 97: '#ffffff',
};

// - convert ANSI SGR colour/bold sequences to <span>-wrapped, HTML-escaped text. Unknown
// - codes (extended 256/truecolor, backgrounds) are ignored, not rendered as garbage.
export function ansiToHtml(input: string): string {
  let html = '';
  let color: string | null = null;
  let bold = false;
  const openSpan = (): string => {
    const st: string[] = [];
    if (color) st.push(`color:${color}`);
    if (bold) st.push('font-weight:bold');
    return st.length ? `<span style="${st.join(';')}">` : '';
  };
  const emit = (text: string) => {
    if (!text) return;
    const s = openSpan();
    html += s ? s + esc(text) + '</span>' : esc(text);
  };
  const apply = (codes: number[]) => {
    for (let k = 0; k < codes.length; k++) {
      const c = codes[k];
      if (c === 38 || c === 48) {                       // - extended colour: skip its params
        if (codes[k + 1] === 5) k += 2; else if (codes[k + 1] === 2) k += 4; else k = codes.length;
      } else if (c === 0) { color = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) color = null;
      else if (ANSI_FG[c] !== undefined) color = ANSI_FG[c];
    }
  };
  // eslint-disable-next-line no-control-regex
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    emit(input.slice(last, m.index));
    apply(m[1] === '' ? [0] : m[1].split(';').map(Number));
    last = re.lastIndex;
  }
  emit(input.slice(last));
  return html;
}

/**
 * Turn a run's collected outputs into a single cell-node payload. A Jupyter cell can emit
 * several outputs (multiple plots, prints + a table); the cell node has one format, so when
 * there is more than one thing to show we stack them as HTML in order. The clean single cases
 * (one plot / one image / just text) keep their native format for interactivity + fidelity.
 */
// - does a text/html payload render anything the user can see? A cell that only touches
// - ipywidgets/tqdm.auto/pandas styling emits an HTML output that is JUST a <style> block
// - (jupyter CSS injection) — non-empty as a string, but invisible. Such output must NOT spawn
// - an (empty) output node. Keep true for anything visual even when it carries no text.
function htmlHasVisibleContent(html: string): boolean {
  if (/<(img|svg|canvas|table|video|iframe|math)\b/i.test(html)) return true;
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return stripped.length > 0;
}

/**
 * Whether a run produced anything worth showing — the gate for creating an output node.
 * Excludes whitespace-only streams and style/script-only HTML (the invisible-node case).
 */
export function hasVisibleOutput(out: CollectedOutput): boolean {
  if (out.error) return true;
  if (out.streamText.trim().length > 0) return true;
  return out.rich.some(r => {
    if (r.mime.startsWith('image/')) return true;
    if (r.mime === 'application/vnd.plotly.v1+json') return true;
    if (r.mime === 'application/vnd.jupyter.widget-view+json') return true;
    if (r.mime === 'text/html') return htmlHasVisibleContent(r.data);
    return r.data.trim().length > 0;   // - text/plain and other text mimes
  });
}

export function renderOutput(out: CollectedOutput): { format: OutputFormat; content: string } {
  const rich = out.rich;
  const lone = rich.length === 1 && !out.error && !out.streamText;

  // - single interactive plotly figure
  if (lone && rich[0].mime === 'application/vnd.plotly.v1+json') {
    return { format: 'plotly', content: rich[0].data };
  }
  // - single image
  if (lone && rich[0].mime.startsWith('image/')) {
    return { format: 'image', content: `data:${rich[0].mime};base64,${rich[0].data}` };
  }
  // - everything else (text-only, mixed, multiple) → HTML in order, ANSI colours preserved
  const parts: string[] = [];
  if (out.streamText) parts.push(`<pre class="skena-out-stream">${ansiToHtml(renderStream(capOutputText(out.streamText)))}</pre>`);
  for (const r of rich) {
    if (r.mime.startsWith('image/')) {
      parts.push(`<img src="data:${r.mime};base64,${r.data}" style="max-width:100%;display:block;margin:6px 0" />`);
    } else if (r.mime === 'text/html') {
      parts.push(`<div>${capOutputHtml(r.data)}</div>`);
    } else if (r.mime === 'application/vnd.plotly.v1+json') {
      parts.push('<pre class="skena-out-note">[plotly figure — one interactive figure per cell run renders inline; multiple are listed only]</pre>');
    } else if (r.mime === 'application/vnd.jupyter.widget-view+json') {
      let modelId = '';
      try { modelId = String((JSON.parse(r.data) as { model_id?: string }).model_id ?? ''); } catch { /* ignore */ }
      const html = modelId ? renderWidget(modelId, out.widgets) : '';
      parts.push(html || '<pre class="skena-out-note">[widget]</pre>');
    } else {
      parts.push(`<pre>${ansiToHtml(capOutputText(r.data))}</pre>`);
    }
  }
  if (out.error) parts.push(`<pre class="skena-out-error">${ansiToHtml(out.error)}</pre>`);
  return { format: 'html', content: parts.join('\n') };
}
