/**
 * The exported page around the nodes: the theme variables the webview gets from VS Code, the
 * section frames, the edge layer, the edge labels, the stylesheets and, when a plotly cell is on
 * it, plotly.js once with the few lines that plot each figure as it scrolls into view. Pure.
 */

import type { DerivedLane } from '../../shared/sectionLanes';
import type { PageBox } from '../../shared/exportLayout';
import type { CanvasNode, KernelNode, KernelRecord } from '../../shared/types';
import { kernelColor } from '../../shared/kernelPalette';
import { fmtDateTime } from '../../shared/dateTime';
import { THEME } from '../../webview/canvas/palette';
import { EDGE_OPACITY, EDGE_WIDTH, type ExportEdge } from './edges';
import { escapeHtml } from './html';

export interface PageSection { id: string; label: string; title: string; color: string; kernelName: string | null; top: number; bottom: number }

/** - the `--vscode-*` variables of a canvas webview (or the fallback set) and the theme kind */
export interface PageTheme { vars: Record<string, string>; dark: boolean }

export interface PageInput {
  title: string;
  box: PageBox;
  sections: PageSection[];
  nodesHtml: string[];
  edges: ExportEdge[];
  /** - stylesheet texts, in cascade order */
  css: string[];
  theme: PageTheme;
  mdTheme: 'vscode' | 'factors';
  /** - skena.markdownMaxWidth in characters; 0 = none */
  mdMaxWidth: number;
  /** - plotly.min.js, only when a plotly figure is on the page */
  plotlyJs: string | null;
}

/**
 * The frame of every section, coloured and named as the rail and the fold band name it: the kernel's
 * colour (else the section's place in the palette), the title or else the creation time, the kernel's name.
 */
export function sectionFrames(lanes: readonly DerivedLane[], nodes: readonly CanvasNode[], records: readonly KernelRecord[]): PageSection[] {
  const kernels = new Map<string, { colorIndex: number; name: string }>();
  for (const k of records) kernels.set(k.id, { colorIndex: k.colorIndex, name: k.displayName ?? 'kernel' });
  for (const n of nodes) {
    if (n.type !== 'kernel') continue;
    const k = n as KernelNode;
    kernels.set(k.id, { colorIndex: k.colorIndex ?? 0, name: k.displayName ?? 'kernel' });
  }
  return lanes.map(l => {
    const k = l.kernelId ? kernels.get(l.kernelId) ?? null : null;
    return {
      id: l.id, label: l.label, title: l.title?.trim() || fmtDateTime(l.createdAt),
      color: kernelColor(k ? k.colorIndex : l.index), kernelName: k?.name ?? null, top: l.top, bottom: l.bottom,
    };
  });
}

// - plots a figure when its cell comes within 1000px of the view, at the size the canvas gives it
const PLOT_SCRIPT = `(function () {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      var fig = JSON.parse(document.getElementById(e.target.dataset.plotly).textContent);
      var layout = Object.assign({}, fig.layout || {}, { width: Number(e.target.dataset.w), height: Number(e.target.dataset.h) });
      Plotly.newPlot(e.target, fig.data, layout, { displaylogo: false, responsive: false });
    });
  }, { rootMargin: '1000px' });
  document.querySelectorAll('[data-plotly]').forEach(function (el) { io.observe(el); });
})();`;

function markerId(color: string, index: number): string {
  return `skena-arrow-${index}-${color.replace(/[^\w]/g, '')}`;
}

function edgeLayer(box: PageBox, edges: readonly ExportEdge[]): string {
  const colors = [...new Set(edges.filter(e => e.arrow).map(e => e.color))];
  const ids = new Map(colors.map((c, i) => [c, markerId(c, i)] as const));
  const defs = colors.map(c => `<marker id="${ids.get(c)}" markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">`
    + `<polyline points="-5,-4 0,0 -5,4 -5,-4" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke="${c}" fill="${c}" opacity="${EDGE_OPACITY}"/></marker>`).join('');
  const paths = edges.map(e => `<path data-edge-id="${escapeHtml(e.id)}" d="${e.d}" fill="none" stroke="${e.color}" stroke-opacity="${EDGE_OPACITY}" stroke-width="${EDGE_WIDTH}"`
    + (e.dashed ? ` stroke-dasharray="${1.5 * EDGE_WIDTH} ${3 * EDGE_WIDTH}"` : '')
    + (e.arrow ? ` marker-end="url(#${ids.get(e.color)})"` : '') + '/>').join('');
  return `<svg class="skena-export-edges" xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.left} ${box.top} ${box.width} ${box.height}" style="left:${box.left}px;top:${box.top}px"><defs>${defs}</defs>${paths}</svg>`;
}

function edgeLabels(edges: readonly ExportEdge[]): string {
  return edges.filter(e => e.label).map(e => `<div class="skena-export-edge-label" style="left:${e.labelAt[0]}px;top:${e.labelAt[1]}px;border-color:${e.color}">${escapeHtml(e.label as string)}</div>`).join('');
}

function frames(box: PageBox, sections: readonly PageSection[]): string {
  return sections.map(s => `<div class="skena-export-section" data-section-id="${escapeHtml(s.id)}" style="left:${box.left}px;top:${s.top}px;width:${box.width}px;height:${s.bottom - s.top}px;border-color:${s.color}">`
    + `<div class="skena-export-section-title" style="color:${s.color}">${escapeHtml(s.label)} · ${escapeHtml(s.title)}`
    + (s.kernelName ? `<span class="skena-export-section-kernel"> · ${escapeHtml(s.kernelName)}</span>` : '') + '</div></div>').join('');
}

export function buildPage(p: PageInput): string {
  if (p.plotlyJs?.includes('</script')) throw new Error('plotly.min.js contains "</script" and cannot be inlined');
  const sk = THEME[p.theme.dark ? 'dark' : 'light'];
  const vars = [
    ...Object.entries(p.theme.vars).map(([k, v]) => `${k}:${v}`),
    ...Object.entries(sk).map(([k, v]) => `--sk-${k}:${v}`),
    `--skena-md-maxw:${p.mdMaxWidth ? `${p.mdMaxWidth}ch` : 'none'}`,
  ].join(';');
  const plot = p.plotlyJs ? `<script>${p.plotlyJs}</script><script>${PLOT_SCRIPT}</script>` : '';
  return '<!doctype html>\n'
    + `<html lang="en" data-md-theme="${p.mdTheme}" style="${escapeHtml(vars)}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(p.title)}</title>${p.css.map(c => `<style>${c}</style>`).join('')}</head>`
    + `<body class="${p.theme.dark ? 'vscode-dark' : 'vscode-light'}">`
    + `<div class="skena-export-page" style="width:${p.box.width}px;height:${p.box.height}px">`
    + `<div class="skena-export-origin" style="left:${-p.box.left}px;top:${-p.box.top}px">`
    + frames(p.box, p.sections) + edgeLayer(p.box, p.edges) + p.nodesHtml.join('') + edgeLabels(p.edges)
    + `</div></div>${plot}</body></html>\n`;
}

/**
 * The theme when no canvas is open to read it from: VS Code's Dark Modern colours for the variables
 * skena's CSS reads (approximate; an open canvas gives the real ones).
 */
export const FALLBACK_THEME: PageTheme = {
  dark: true,
  vars: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-foreground': '#cccccc',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-editorWidget-border': '#313131',
    '--vscode-sideBar-background': '#181818',
    '--vscode-list-hoverBackground': '#2a2d2e',
    '--vscode-textCodeBlock-background': '#2b2b2b',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-editorWarning-foreground': '#cca700',
    '--vscode-inputValidation-warningBackground': '#352a05',
    '--vscode-button-secondaryBackground': '#313131',
    '--vscode-widget-border': '#313131',
    '--vscode-font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
    '--vscode-font-size': '13px',
    '--vscode-editor-font-family': 'Menlo, Monaco, "Courier New", monospace',
    '--vscode-editor-font-size': '14px',
  },
};
