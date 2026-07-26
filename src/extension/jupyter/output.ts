import type { CollectedOutput } from './protocol';

export type OutputFormat = 'markdown' | 'image' | 'html' | 'plotly';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Turn a run's collected outputs into a single cell-node payload. A Jupyter cell can emit
 * several outputs (multiple plots, prints + a table); the cell node has one format, so when
 * there is more than one thing to show we stack them as HTML in order. The clean single cases
 * (one plot / one image / just text) keep their native format for interactivity + fidelity.
 */
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
  // - text only (no rich) → markdown code block(s)
  if (rich.length === 0) {
    let md = out.streamText ? '```\n' + out.streamText + '\n```' : '';
    if (out.error) md += (md ? '\n\n' : '') + '```\n' + out.error + '\n```';
    return { format: 'markdown', content: md };
  }
  // - multiple / mixed outputs → stack them (in order) as one HTML block
  const parts: string[] = [];
  if (out.streamText) parts.push(`<pre class="skena-out-stream">${esc(out.streamText)}</pre>`);
  for (const r of rich) {
    if (r.mime.startsWith('image/')) {
      parts.push(`<img src="data:${r.mime};base64,${r.data}" style="max-width:100%;display:block;margin:6px 0" />`);
    } else if (r.mime === 'text/html') {
      parts.push(`<div>${r.data}</div>`);
    } else if (r.mime === 'application/vnd.plotly.v1+json') {
      parts.push('<pre class="skena-out-note">[plotly figure — one interactive figure per cell run renders inline; multiple are listed only]</pre>');
    } else {
      parts.push(`<pre>${esc(r.data)}</pre>`);
    }
  }
  if (out.error) parts.push(`<pre class="skena-out-error">${esc(out.error)}</pre>`);
  return { format: 'html', content: parts.join('\n') };
}
