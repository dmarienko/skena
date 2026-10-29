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
import { escapeHtml, staticHtml } from './html';
import { fileMarkdownHtml, nodeMarkdownHtml, rendererMarkdownHtml, rendersOnHost } from './markdown';
import {
  cellFigures, cellNodeHtml, chatNodeHtml, codeNodeHtml, errorNodeHtml, fileNodeHtml, kernelNodeHtml, knowledgeNodeHtml, linkNodeHtml,
  NODE_BORDER, noderefNodeHtml, notebookHtml, portalNodeHtml, textNodeHtml, type Figure, type FileView,
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

// - the file types the page shows from the file's text; any other file is never read
const SHOWN_TEXT_TYPES = new Set<FileType>(['markdown', 'python', 'yaml', 'html', 'notebook']);
const NO_PREVIEW = '<div class="skena-unknown">No preview available</div>';

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

  // - each image address of a node as a data url, or null when it cannot be read (listed in `missing`);
  //   `dir` resolves a relative path, `server` is the knowledge server of a knowledge node
  const resolveImages = async (sources: string[], label: string, dir: string, server?: string): Promise<Map<string, string | null>> => {
    const resolved = new Map<string, string | null>();
    await Promise.all(sources.map(async where => {
      try {
        if (/^https?:/i.test(where)) {
          if (!deps.fetchImage) throw new Error('no network fetch given');
          resolved.set(where, await deps.fetchImage(where));
        } else if (SERVER_URI.test(where) && !PLAIN_URI.test(where)) {
          if (!server || !deps.knowledgeAsset) throw new Error('no knowledge server for this image');
          resolved.set(where, await deps.knowledgeAsset(server, where));
        } else {
          const file = deps.resolveFile(where.replace(/^file:\/\//, ''), dir);
          if (!file) throw new Error('does not resolve');
          resolved.set(where, await fileDataUrl(file.fsPath));
        }
      } catch (e) {
        resolved.set(where, null);
        missing.push(`${label} ${where}: ${(e as Error).message}`);
      }
    }));
    return resolved;
  };

  // - a file node's view, the folder its images resolve from, and the figures of a notebook's plotly outputs
  const fileView = async (n: FileNode): Promise<FileView & { dir?: string; figures?: Figure[] }> => {
    const title = filenameFromUri(n.file ?? '');
    const file = deps.resolveFile(n.file ?? '', canvasDir);
    if (!file) return { fileType: 'unknown', title, body: '<div class="skena-error">Error: NOT_FOUND</div>' };
    try {
      if (file.fileType === 'image') {
        return { fileType: 'image', title, body: `<img src="${await fileDataUrl(file.fsPath)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block">` };
      }
      if (!SHOWN_TEXT_TYPES.has(file.fileType)) return { fileType: file.fileType, title, body: NO_PREVIEW };
      const text = await fs.readFile(file.fsPath, 'utf-8');
      if (file.fileType === 'markdown') {
        const fm = extractFrontmatter(text);
        const html = await fileMarkdownHtml(text, factors, hl);
        return { fileType: 'markdown', title: fm.title ?? title, status: fm.status, type: fm.type, body: `<div class="skena-markdown">${html}</div>`, dir: path.dirname(file.fsPath) };
      }
      const code = (src: string, lang: string) => `<div class="skena-code" style="font-size:11px;line-height:1.5;overflow:auto">${hl.codeToHtml(src, { lang, theme: factors ? 'factors' : 'dark-plus' })}</div>`;
      if (file.fileType === 'python' || file.fileType === 'yaml') return { fileType: file.fileType, title, body: code(text, file.fileType) };
      if (file.fileType === 'html') return { fileType: 'html', title, body: `<div class="skena-html"><template shadowrootmode="open">${text}</template></div>`, dir: path.dirname(file.fsPath) };
      if (file.fileType === 'notebook') {
        const nb = parseNotebook(text);
        const md = await Promise.all(nb.cells.map(c => (c.type === 'markdown' ? rendererMarkdownHtml(c.source) : Promise.resolve(''))));
        const lang = hl.getLoadedLanguages().includes(nb.languageName) ? nb.languageName : 'python';
        const view = notebookHtml(nb, md, deps.notebookShowSource, s => code(s, lang), `skena-fig-${n.id}`, n.width - 2 * NODE_BORDER - 16, mdStyle);
        return { fileType: 'notebook', title, body: view.html, dir: path.dirname(file.fsPath), figures: view.figures };
      }
      return { fileType: file.fileType, title, body: NO_PREVIEW };
    } catch (e) {
      return { fileType: file.fileType, title, body: `<div class="skena-error">Error: ${escapeHtml((e as Error).message)}</div>` };
    }
  };

  // - one node's html as its builder writes it; the folder and knowledge server its images resolve
  //   from; the plotly figures its boxes name
  const render = async (n: CanvasNode): Promise<{ html: string; dir?: string; server?: string; figures?: Figure[] }> => {
    switch (n.type) {
      case 'text': {
        const text = n.text ?? '';
        return { html: textNodeHtml(n, await nodeMarkdownHtml(text, factors, hl), rendersOnHost(text, factors) ? '' : mdStyle) };
      }
      case 'knowledge': {
        const text = n.text ?? '';
        return { html: knowledgeNodeHtml(n, await nodeMarkdownHtml(text, factors, hl), rendersOnHost(text, factors) ? '' : mdStyle), server: n.server };
      }
      case 'code': return { html: codeNodeHtml(n, codeCellHtml(n.code ?? '', codeTok, editorBg, deps.theme.dark)) };
      case 'cell': {
        const md = n.format === 'markdown' ? await rendererMarkdownHtml(n.content ?? '') : null;
        return { html: cellNodeHtml(n, md, mdStyle), figures: cellFigures(n) };
      }
      case 'file': {
        const view = await fileView(n);
        return { html: fileNodeHtml(n, view), dir: view.dir, figures: view.figures };
      }
      case 'link': return { html: linkNodeHtml(n) };
      case 'portal': return { html: portalNodeHtml(n) };
      case 'noderef': return { html: noderefNodeHtml(n) };
      case 'kernel': return { html: kernelNodeHtml(n) };
      case 'chat': return { html: chatNodeHtml(n) };
      default: return { html: '' };
    }
  };

  const nodesHtml: string[] = [];
  const figures: Figure[] = [];
  for (const [i, n] of layout.nodes.entries()) {
    const label = n.nodeLabel ?? n.id;
    try {
      const r = await render(n);
      // - every node's html goes through the one pass that makes it static, its images put in
      nodesHtml.push(await staticHtml(r.html, sources => resolveImages(sources, label, r.dir ?? canvasDir, r.server)));
      figures.push(...r.figures ?? []);
    } catch (e) {
      nodesHtml.push(errorNodeHtml(n, (e as Error).message));
    }
    deps.progress?.(i + 1, layout.nodes.length);
    await yieldToHost();
  }

  const read = (f: string) => fs.readFile(path.join(deps.assetDir, f), 'utf-8');
  const css = [await read('export-assets/katex.css'), await read('export-assets/codicon.css')];
  if (factors) css.push(await read('export-assets/ibm-plex.css'));
  css.push(await read('export-assets/skena.css'));
  const plotlyJs = figures.length ? await read('plotly.min.js') : null;

  const html = buildPage({
    title: path.basename(canvasPath, '.canvas'),
    box,
    sections: sectionFrames(layout.lanes, layout.nodes, canvas.metadata?.kernels ?? []),
    nodesHtml,
    edges,
    figures,
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
