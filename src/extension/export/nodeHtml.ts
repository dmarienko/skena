/**
 * One canvas node as static HTML at its canvas position, drawn after its webview component (the
 * same classes, borders and header rows) without anything that needs React Flow, Monaco or the
 * host: no handles, no resizer, no buttons. The bodies come in already rendered (markdown html,
 * code lines); the plain ones are built here. Content goes in as it is: the export makes every
 * node's html static afterwards (html.ts staticHtml). Pure.
 */

import type { CanvasNode, CellNode, ChatNode, CodeNode, FileNode, FileType, KernelNode, KnowledgeNode, LinkNode, NoderefNode, PortalNode, TextNode } from '../../shared/types';
import { FILE_TYPE_COLORS, FILE_TYPE_ICONS, STATUS_COLORS } from '../../shared/constants';
import { kernelColor } from '../../shared/kernelPalette';
import { fmtDateTime } from '../../shared/dateTime';
import { nodeBorderColor } from '../../webview/canvas/palette';
import { canvasColor } from './edges';
import { escapeHtml } from './html';
import { capOutputHtml } from '../../shared/outputCap';
import type { CellOutput, ParsedNotebook } from '../notebook-parser';

/** - a node border of 1.5 px through the zoom-invariant scaler at zoom 1 (BORDER_WIDTH_SCALE 1.8) */
export const NODE_BORDER = 2.7;

export function borderOf(node: CanvasNode): string {
  return escapeHtml(nodeBorderColor(node.type, canvasColor(node.color)) ?? '#6b7280');
}

/**
 * The node's box on the page: positioned at its canvas x/y/width/height, its label badge in the
 * top-right corner (`badge` false for a node that draws its label inside), and the AI pill.
 */
export function placeNode(node: CanvasNode, inner: string, badge = true): string {
  const label = badge && node.nodeLabel ? `<span class="skena-export-label">${escapeHtml(node.nodeLabel)}</span>` : '';
  const ai = node.createdBy === 'ai' ? '<span class="skena-export-ai">AI</span>' : '';
  return `<div class="skena-export-node" data-node-id="${escapeHtml(String(node.id))}" data-label="${escapeHtml(String(node.nodeLabel ?? ''))}"`
    + ` style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;contain-intrinsic-size:${node.width}px ${node.height}px">`
    + `${inner}${label}${ai}</div>`;
}

// - the card every rectangular node draws (.skena-node, its type class, the coloured border)
function card(type: string, border: string, body: string, style = ''): string {
  return `<div class="skena-node skena-node--${type}" style="border:${NODE_BORDER}px solid ${border};height:100%;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;${style}">${body}</div>`;
}

function scroll(inner: string, padding = '6px 8px 6px 12px'): string {
  return `<div class="skena-export-scroll" style="padding:${padding}">${inner}</div>`;
}

// - rendered markdown in the class MarkdownRenderer gives it; `mdStyle` is the markdown.preview font it applies
function markdownDiv(html: string, mdStyle: string): string {
  return `<div class="skena-markdown"${mdStyle ? ` style="${escapeHtml(mdStyle)}"` : ''}>${html}</div>`;
}

/** - a text note: its markdown html; `mdStyle` is the markdown.preview font the webview path applies */
export function textNodeHtml(node: TextNode, html: string, mdStyle = ''): string {
  return placeNode(node, card('text', borderOf(node), scroll(markdownDiv(html, mdStyle))));
}

/** - a knowledge node: the server › title · date row, then the whole stored text */
export function knowledgeNodeHtml(node: KnowledgeNode, html: string, mdStyle = ''): string {
  const border = borderOf(node);
  const t = Date.parse(node.fetchedAt);
  const fetched = Number.isNaN(t) ? 'never fetched' : `fetched ${fmtDateTime(t)}`;
  const head = `<div class="skena-export-head" title="${escapeHtml(node.error ?? node.uri ?? '')}" style="border-bottom:1px solid ${border}">`
    + `<span style="opacity:0.7">${escapeHtml(node.server ?? '')}</span><span style="opacity:0.4">›</span>`
    + (node.changed ? `<span style="color:${border}">●</span>` : '')
    + `<span class="skena-export-title">${escapeHtml(node.title ?? '')}</span><span style="opacity:0.4">·</span>`
    + `<span style="opacity:0.6">${fetched}</span>${node.error ? '<span style="opacity:0.6">!</span>' : ''}</div>`;
  return placeNode(node, card('knowledge', border, head + scroll(markdownDiv(html, mdStyle))));
}

const STATUS_GLYPH: Record<string, string> = { running: '◗', ok: '✓', error: '✗' };

/** - a code cell: the language and status row, then its lines on the editor background */
export function codeNodeHtml(node: CodeNode, linesHtml: string): string {
  const border = borderOf(node);
  const glyph = STATUS_GLYPH[node.lastStatus ?? ''] ?? '';
  const head = `<div class="skena-export-head" style="border-bottom:1px solid ${border};height:24px">`
    + `<span style="opacity:0.7">${escapeHtml(node.language ?? 'python')}</span>`
    + `<span style="margin-left:auto;font-size:14px;color:${node.lastStatus === 'error' ? '#e5484d' : border}">${glyph}</span></div>`;
  const body = (node.code ?? '').trim() ? linesHtml : '<div style="padding:8px;opacity:0.5;font-size:12px;font-style:italic">empty</div>';
  return placeNode(node, card('code', border, head + scroll(body, '0'), 'background:var(--vscode-editorWidget-background)'));
}

/** - an output cell; `markdownHtml` is the rendered content of a markdown cell (null for the others), in the `mdStyle` font */
export function cellNodeHtml(node: CellNode, markdownHtml: string | null, mdStyle = ''): string {
  let body: string;
  if (node.format === 'markdown') body = markdownDiv(markdownHtml ?? '', mdStyle);
  else if (node.format === 'image') body = `<img src="${escapeHtml(node.content ?? '')}" alt="cell" style="max-width:100%;max-height:100%;object-fit:contain">`;
  else if (node.format === 'html') body = `<div class="skena-cell-html">${capOutputHtml(node.content ?? '')}</div>`;
  else {
    // - the plot fills the scroll box inside the border and its 6px 8px padding, as on the canvas
    body = plotlyEmbed(cellFigureId(node), node.width - 2 * NODE_BORDER - 16, node.height - 2 * NODE_BORDER - 12);
  }
  return placeNode(node, `<div class="skena-node skena-node--cell" style="border:${NODE_BORDER}px dashed ${borderOf(node)};height:100%;border-radius:6px;overflow:hidden;display:flex;flex-direction:column">${scroll(body, '6px 8px')}</div>`);
}

export interface FileView {
  fileType: FileType;
  /** - the frontmatter title, else the file name without its extension */
  title: string;
  status?: string;
  type?: string;
  /** - the rendered content, or the reason there is none */
  body: string;
}

// - StatusBadge: a frontmatter status as a coloured pill
function statusBadge(status: string): string {
  const c = STATUS_COLORS[status] ?? '#6b7280';
  return `<span style="font-size:9px;padding:1px 5px;border-radius:10px;background:${c}22;border:1px solid ${c}66;color:${c};font-weight:600;text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0">${escapeHtml(status)}</span>`;
}

/** - a file node: the header row of NodeHeader, then the file's content */
export function fileNodeHtml(node: FileNode, view: FileView): string {
  const border = borderOf(node);
  const tint = FILE_TYPE_COLORS[view.fileType] ?? FILE_TYPE_COLORS.unknown;
  const icon = FILE_TYPE_ICONS[view.fileType] ?? 'file';
  const head = `<div class="skena-export-file-head" title="${escapeHtml(node.file ?? '')}" style="border-bottom:1px solid ${border}40;background:${tint}22">`
    + `<span class="codicon codicon-${icon}" style="font-size:16px;opacity:0.7"></span>`
    + `<span class="skena-export-title" style="flex:1;font-size:16px;font-weight:600">${escapeHtml(view.title)}</span>`
    + (view.status ? statusBadge(view.status) : '')
    + (view.type ? `<span style="font-size:11px;opacity:0.5;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(view.type)}</span>` : '')
    + '</div>';
  return placeNode(node, card('file', border, head + scroll(view.body, '6px 8px')));
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** - a link: its host name and the address as text and as a plain link (no favicon, no thumbnail) */
export function linkNodeHtml(node: LinkNode): string {
  const url = node.url ?? '';
  const body = `<div style="font-size:11px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(hostname(url))}</div>`
    + `<a href="${escapeHtml(url)}" style="font-size:12px;word-break:break-all;opacity:0.85">${escapeHtml(url)}</a>`;
  return placeNode(node, card('link', borderOf(node), body, 'background:var(--vscode-editorWidget-background);padding:8px 10px;gap:6px'));
}

function canvasBasename(p = ''): string {
  const name = p.replace(/^(\.\.?\/)+/, '').split('/').pop() ?? p;
  return name.endsWith('.canvas') ? name.slice(0, -7) : name;
}

/** - a portal: the circle with the target canvas's name */
export function portalNodeHtml(node: PortalNode): string {
  const border = borderOf(node);
  const inner = `<div style="border:${2 * 1.8}px solid ${border};height:100%;box-sizing:border-box;border-radius:50%;overflow:hidden;background:${border}12;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12%">`
    + `<span style="font-size:18px;font-weight:600;opacity:0.85;text-align:center;word-break:break-word;line-height:1.2">${escapeHtml(node.label ?? canvasBasename(node.canvas))}</span>`
    + '<span style="font-size:11px;opacity:0.4">canvas</span></div>';
  return placeNode(node, inner);
}

/** - a reference to a node in another canvas: the diamond with canvas › label */
export function noderefNodeHtml(node: NoderefNode): string {
  const border = borderOf(node);
  const inner = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">'
    + `<polygon points="50,1 99,50 50,99 1,50" fill="var(--vscode-editorWidget-background, #202020)" stroke="${border}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`
    + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 18px"><div>'
    + `<div style="font-size:12px;font-weight:700">${escapeHtml(canvasBasename(node.canvas))} › ${escapeHtml(node.label ?? '')}</div>`
    + (node.title ? `<div style="font-size:10px;opacity:0.6;margin-top:2px">${escapeHtml(node.title)}</div>` : '')
    + '</div></div>';
  return placeNode(node, inner);
}

/** - a kernel node: its name and the ring with its label inside; the status light is off (no live kernel) */
export function kernelNodeHtml(node: KernelNode): string {
  const accent = kernelColor(node.colorIndex ?? 0);
  const title = `${node.displayName ?? 'kernel'} :: ${node.kernelId ? node.kernelId.slice(0, 10) : '—'}`;
  const inner = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px">'
    + `<div style="color:${accent};font-size:12px;font-family:var(--vscode-editor-font-family, monospace);white-space:nowrap">${escapeHtml(title)}</div>`
    + `<div style="position:relative;width:72px;height:72px"><div style="position:absolute;inset:0;border-radius:50%;border:2px solid ${accent}"></div>`
    + '<div style="position:absolute;inset:22px;border-radius:50%;background:#6b7280"></div>'
    + (node.nodeLabel ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:20px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.7)">${escapeHtml(node.nodeLabel)}</div>` : '')
    + '</div></div>';
  return placeNode(node, inner, false);
}

/** - a chat node: its title row (the node has no content of its own) */
export function chatNodeHtml(node: ChatNode): string {
  const border = borderOf(node);
  const head = `<div class="skena-export-head" style="border-bottom:1px solid ${border}40;font-weight:600">`
    + `<span>💬</span><span>${escapeHtml(node.title ?? '')}</span><span style="margin-left:auto;opacity:0.5;font-weight:400">${escapeHtml(node.agent ?? '')}${node.model ? ` · ${escapeHtml(node.model)}` : ''}</span></div>`;
  return placeNode(node, card('chat', border, head, 'background:var(--vscode-editorWidget-background)'));
}

/** - a plotly figure on the page: the id its box names, and its JSON (the page writes it after the nodes) */
export interface Figure { id: string; json: string }

const cellFigureId = (node: CellNode) => `skena-fig-${node.id}`;

/** - the figure of a plotly output cell, null for the other formats */
export function cellFigure(node: CellNode): Figure | null {
  return node.format === 'plotly' ? { id: cellFigureId(node), json: node.content ?? '' } : null;
}

/** - a node whose html could not be built: its box with the reason, so the rest of the page is still written */
export function errorNodeHtml(node: CanvasNode, message: string): string {
  return placeNode(node, card('error', '#e5484d', `<div class="skena-error">Export failed: ${escapeHtml(message)}</div>`));
}

// - a plotly figure's box: empty, the page's plotting script fills it when it scrolls near
export function plotlyEmbed(figId: string, w: number, h: number): string {
  return `<div class="skena-plotly" data-plotly="${escapeHtml(figId)}" data-w="${w}" data-h="${h}" style="width:100%;height:100%"></div>`;
}

function notebookOutput(out: CellOutput, figId: string, plotWidth: number, figures: Figure[]): string {
  const wrap = (inner: string, style = '') => `<div class="skena-notebook__output"${style ? ` style="${style}"` : ''}>${inner}</div>`;
  switch (out.mimeType) {
    case 'image/png':
    case 'image/svg+xml': return wrap(`<img src="data:${out.mimeType};base64,${out.data}" alt="output" style="max-width:100%">`);
    case 'text/html': return wrap(`<div class="skena-notebook__html-output">${out.html}</div>`);
    case 'application/vnd.plotly.v1+json':
      figures.push({ id: figId, json: out.json });
      return wrap(plotlyEmbed(figId, plotWidth, 400), 'position:relative;height:400px');
    case 'text/plain': return wrap(`<pre class="skena-notebook__text-output">${escapeHtml(out.text)}</pre>`);
    default: return wrap(`<div class="skena-notebook__placeholder">${escapeHtml(out.label)}</div>`);
  }
}

/**
 * A notebook as NotebookRenderer shows it: markdown cells (`mdHtml[i]` holds cell i rendered), each
 * code cell's outputs, and its source with the execution count when `showSource`
 * (skena.notebook.showSourceCells). `codeHtml` colours a source as the file previews do. Markdown
 * cells are in the `mdStyle` font. The plotly outputs come back as figures for the page.
 */
export function notebookHtml(nb: ParsedNotebook, mdHtml: readonly string[], showSource: boolean, codeHtml: (source: string) => string, figPrefix: string, plotWidth: number, mdStyle = ''): { html: string; figures: Figure[] } {
  const figures: Figure[] = [];
  const cells = nb.cells.map((cell, i) => {
    if (cell.type === 'markdown') return `<div class="skena-notebook__cell">${markdownDiv(mdHtml[i] ?? '', mdStyle)}</div>`;
    if (cell.type === 'raw') return `<div class="skena-notebook__cell"><pre>${escapeHtml(cell.source)}</pre></div>`;
    if (!showSource && cell.outputs.length === 0) return '';
    const source = showSource
      ? `<div class="skena-notebook__code-prompt"><span class="skena-notebook__execution-count">${cell.executionCount != null ? `[${cell.executionCount}]` : '[ ]'}</span>${codeHtml(cell.source)}</div>`
      : '';
    const outputs = cell.outputs.length
      ? `<div class="skena-notebook__outputs-group">${cell.outputs.map((o, k) => notebookOutput(o, `${figPrefix}-${i}-${k}`, plotWidth, figures)).join('')}</div>`
      : '';
    return `<div class="skena-notebook__cell">${source}${outputs}</div>`;
  });
  return { html: `<div class="skena-notebook">${cells.join('')}</div>`, figures };
}
