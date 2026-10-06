/**
 * Exports a .canvas file to one HTML page that needs no network: reads the file (never writes it),
 * lays it out (shared/exportLayout.ts), renders every node with skena's own renderers, puts every
 * image in as a data url and returns the page. No vscode import: the command and the relay endpoint
 * the MCP tool calls both run it with what they read from VS Code (ExportDeps).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CanvasData, CanvasNode, FileNode, FileType } from '../../shared/types';
import { exportLayout, pageBox } from '../../shared/exportLayout';
import { extractFrontmatter, filenameFromUri } from '../../shared/fileHeader';
import { codeTokenizer } from '../../webview/canvas/codeCellShiki';
import { parseNotebook } from '../notebook-parser';
import { exportEdges } from './edges';
import { codeCellHtml } from './codeHtml';
import { balanceHtml, decodeAttr, escapeHtml, imageSources, stripActiveHtml, swapImageSources } from './html';
import { fileMarkdownHtml, nodeMarkdownHtml, rendersOnHost } from './markdown';
import {
  cellNodeHtml, chatNodeHtml, codeNodeHtml, fileNodeHtml, kernelNodeHtml, knowledgeNodeHtml, linkNodeHtml,
  NODE_BORDER, noderefNodeHtml, notebookHtml, portalNodeHtml, textNodeHtml, type FileView,
} from './nodeHtml';
import { buildPage, sectionFrames, type PageTheme } from './page';
import { exportHighlighter } from './shikiHost';

export interface ExportDeps {
  /** - the extension's dist/: plotly.min.js and export-assets/*.css */
  assetDir: string;
  /** - skena.code.theme */
  codeTheme: string;
  /** - skena.markdownTheme */
  mdTheme: 'vscode' | 'factors';
  /** - skena.markdownMaxWidth */
  mdMaxWidth: number;
  /** - markdown.preview.fontFamily / fontSize, which the webview's own markdown path applies */
  mdFont?: { family?: string; size?: number };
  /** - skena.notebook.showSourceCells */
  notebookShowSource: boolean;
  theme: PageTheme;
  /** - a file node's uri to its path and type, as FileResolver resolves it; null when it does not resolve */
  resolveFile: (uri: string, canvasDir: string) => { fsPath: string; fileType: FileType } | null;
  /** - an image a knowledge server serves, as a data url (KnowledgeService.asset) */
  knowledgeAsset?: (server: string, uri: string) => Promise<string>;
  /** - an http(s) image as a data url */
  fetchImage?: (url: string) => Promise<string>;
  progress?: (done: number, total: number) => void;
}

export interface ExportResult {
  html: string;
  nodes: number;
  edges: number;
  /** - images that could not be read: "<node label> <address>: <reason>" */
  missing: string[];
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

// - an image address only a knowledge server can serve (knowledgeAssets.isKnowledgeUri)
const SERVER_URI = /^[a-z][a-z0-9+.-]*:\/\//i;
const PLAIN_URI = /^(https?|data|blob|file|vscode-[a-z-]+):/i;

// - only an image type is read and put in, as the canvas webview makes data urls only for those
async function fileDataUrl(fsPath: string): Promise<string> {
  const mime = IMAGE_MIME[path.extname(fsPath).toLowerCase()];
  if (!mime) throw new Error('not an image file');
  return `data:${mime};base64,${(await fs.readFile(fsPath)).toString('base64')}`;
}

// - lets the extension host's event loop run between two nodes; a large paper takes seconds to render
const yieldToHost = () => new Promise<void>(resolve => setImmediate(resolve));

export async function exportCanvasHtml(canvasPath: string, deps: ExportDeps): Promise<ExportResult> {
  const canvasDir = path.dirname(canvasPath);
  const raw = (await fs.readFile(canvasPath, 'utf-8')).trim();
  const parsed = (raw ? JSON.parse(raw) : {}) as Partial<CanvasData>;
  const canvas: CanvasData = { ...(parsed as CanvasData), nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
  const layout = exportLayout(canvas, Date.now());
  const edges = exportEdges(layout);
  const box = pageBox(layout, edges.flatMap(e => [...e.points, e.labelAt]));
  const { hl, codeTheme } = await exportHighlighter(deps.codeTheme);
  const factors = deps.mdTheme === 'factors';
  const codeTok = codeTokenizer(hl, codeTheme);
  const editorBg = deps.theme.vars['--vscode-editor-background'] ?? (deps.theme.dark ? '#1e1e1e' : '#ffffff');
  const mdStyle = [deps.mdFont?.family && `font-family:${deps.mdFont.family}`, deps.mdFont?.size && `font-size:${deps.mdFont.size}px`].filter(Boolean).join(';');
  const missing: string[] = [];

  // - every <img> of `html` that is not a data url, read and put in; `dir` resolves a relative path
  const inlineImages = async (html: string, label: string, dir: string, server?: string): Promise<string> => {
    const resolved = new Map<string, string | null>();
    await Promise.all(imageSources(html).map(async src => {
      const where = decodeAttr(src);
      try {
        if (/^https?:/i.test(where)) {
          if (!deps.fetchImage) throw new Error('no network fetch given');
          resolved.set(src, await deps.fetchImage(where));
        } else if (SERVER_URI.test(where) && !PLAIN_URI.test(where)) {
          if (!server || !deps.knowledgeAsset) throw new Error('no knowledge server for this image');
          resolved.set(src, await deps.knowledgeAsset(server, where));
        } else {
          const file = deps.resolveFile(where.replace(/^file:\/\//, ''), dir);
          if (!file) throw new Error('does not resolve');
          resolved.set(src, await fileDataUrl(file.fsPath));
        }
      } catch (e) {
        resolved.set(src, null);
        missing.push(`${label} ${where}: ${(e as Error).message}`);
      }
    }));
    return resolved.size ? swapImageSources(html, resolved) : html;
  };

  const fileView = async (n: FileNode): Promise<FileView> => {
    const title = filenameFromUri(n.file);
    const file = deps.resolveFile(n.file, canvasDir);
    if (!file) return { fileType: 'unknown', title, body: '<div class="skena-error">Error: NOT_FOUND</div>' };
    try {
      if (file.fileType === 'image') {
        return { fileType: 'image', title, body: `<img src="${await fileDataUrl(file.fsPath)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block">` };
      }
      const text = await fs.readFile(file.fsPath, 'utf-8');
      if (file.fileType === 'markdown') {
        const fm = extractFrontmatter(text);
        const html = await inlineImages(await fileMarkdownHtml(text, factors, hl), n.nodeLabel ?? n.id, path.dirname(file.fsPath));
        return { fileType: 'markdown', title: fm.title ?? title, status: fm.status, type: fm.type, body: `<div class="skena-markdown">${stripActiveHtml(html)}</div>` };
      }
      const code = (src: string, lang: string) => `<div class="skena-code" style="font-size:11px;line-height:1.5;overflow:auto">${hl.codeToHtml(src, { lang, theme: factors ? 'factors' : 'dark-plus' })}</div>`;
      if (file.fileType === 'python' || file.fileType === 'yaml') return { fileType: file.fileType, title, body: code(text, file.fileType) };
      if (file.fileType === 'html') return { fileType: 'html', title, body: `<div class="skena-html"><template shadowrootmode="open">${stripActiveHtml(text)}</template></div>` };
      if (file.fileType === 'notebook') {
        const nb = parseNotebook(text);
        const md = await Promise.all(nb.cells.map(c => (c.type === 'markdown' ? nodeMarkdownHtml(c.source, factors, hl) : Promise.resolve(''))));
        const lang = hl.getLoadedLanguages().includes(nb.languageName) ? nb.languageName : 'python';
        const body = notebookHtml(nb, md, deps.notebookShowSource, s => code(s, lang), `skena-fig-${n.id}`, n.width - 2 * NODE_BORDER - 16);
        return { fileType: 'notebook', title, body: await inlineImages(body, n.nodeLabel ?? n.id, path.dirname(file.fsPath)) };
      }
      return { fileType: file.fileType, title, body: '<div class="skena-unknown">No preview available</div>' };
    } catch (e) {
      return { fileType: file.fileType, title, body: `<div class="skena-error">Error: ${escapeHtml((e as Error).message)}</div>` };
    }
  };

  const render = async (n: CanvasNode): Promise<string> => {
    const label = n.nodeLabel ?? n.id;
    switch (n.type) {
      case 'text': {
        const html = await inlineImages(await nodeMarkdownHtml(n.text, factors, hl), label, canvasDir);
        return textNodeHtml(n, html, rendersOnHost(n.text, factors) ? '' : mdStyle);
      }
      case 'knowledge': {
        const html = await inlineImages(await nodeMarkdownHtml(n.text, factors, hl), label, canvasDir, n.server);
        return knowledgeNodeHtml(n, html, rendersOnHost(n.text, factors) ? '' : mdStyle);
      }
      case 'code': return codeNodeHtml(n, codeCellHtml(n.code ?? '', codeTok, editorBg, deps.theme.dark));
      case 'cell': {
        const md = n.format === 'markdown' ? await nodeMarkdownHtml(n.content, factors, hl) : null;
        return inlineImages(cellNodeHtml(n, md), label, canvasDir);
      }
      case 'file': return fileNodeHtml(n, await fileView(n));
      case 'link': return linkNodeHtml(n);
      case 'portal': return portalNodeHtml(n);
      case 'noderef': return noderefNodeHtml(n);
      case 'kernel': return kernelNodeHtml(n);
      case 'chat': return chatNodeHtml(n);
      default: return '';
    }
  };

  const nodesHtml: string[] = [];
  for (const [i, n] of layout.nodes.entries()) {
    nodesHtml.push(balanceHtml(await render(n)));
    deps.progress?.(i + 1, layout.nodes.length);
    await yieldToHost();
  }

  const read = (f: string) => fs.readFile(path.join(deps.assetDir, f), 'utf-8');
  const css = [await read('export-assets/katex.css'), await read('export-assets/codicon.css')];
  if (factors) css.push(await read('export-assets/ibm-plex.css'));
  css.push(await read('export-assets/skena.css'));
  const plotlyJs = nodesHtml.some(h => h.includes('data-plotly=')) ? await read('plotly.min.js') : null;

  const html = buildPage({
    title: path.basename(canvasPath, '.canvas'),
    box,
    sections: sectionFrames(layout.lanes, layout.nodes, canvas.metadata?.kernels ?? []),
    nodesHtml,
    edges,
    css,
    theme: deps.theme,
    mdTheme: deps.mdTheme,
    mdMaxWidth: deps.mdMaxWidth,
    plotlyJs,
  });
  return { html, nodes: layout.nodes.length, edges: edges.length, missing };
}

const CANVAS_FILE = /\.canvas$/i;

// - a target that is a .canvas file, or names the canvas through a link, is refused before anything is rendered
async function checkExportTarget(canvasPath: string, target: string): Promise<void> {
  const real = (p: string) => fs.realpath(p).catch(() => path.resolve(p));
  const [t, c] = await Promise.all([real(target), real(canvasPath)]);
  if (t === c) throw new Error(`not writing the page to ${target}: it is the canvas being exported`);
  if (CANVAS_FILE.test(target) || CANVAS_FILE.test(t)) throw new Error(`not writing the page to ${target}: that is a .canvas file`);
}

/**
 * Exports `canvasPath` and writes the page to `target`. The command and the relay's /export both
 * write through here, and it never writes over a canvas: not the one it reads, not another .canvas
 * file, not a link to one.
 */
export async function exportCanvasToFile(canvasPath: string, target: string, deps: ExportDeps): Promise<ExportResult> {
  await checkExportTarget(canvasPath, target);
  const r = await exportCanvasHtml(canvasPath, deps);
  await fs.writeFile(target, r.html, 'utf-8');
  return r;
}

/** - the page the command and the MCP tool write when no path is given: next to the canvas, same name */
export function defaultHtmlPath(canvasPath: string): string {
  return path.join(path.dirname(canvasPath), `${path.basename(canvasPath, '.canvas')}.html`);
}
