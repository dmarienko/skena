/**
 * The VS Code side of the HTML export: what exportCanvasHtml needs, read from the settings, the
 * open canvas webviews and the knowledge servers; the "Skena: Export canvas to HTML" command; and
 * the file write both the command and the relay's /export (the MCP tool) go through.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { ExportReply } from '../../shared/types';
import { FileResolver } from '../file-resolver';
import { getVaults } from '../settings';
import type { SkenaEditorProvider } from '../editor-provider';
import { defaultHtmlPath, exportCanvasToFile, type ExportDeps } from './exportCanvas';
import { FALLBACK_THEME } from './page';

// - an http(s) image for the page, as a data url; 15 s per image
async function fetchDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

async function exportDeps(context: vscode.ExtensionContext, provider: SkenaEditorProvider, canvasPath: string, progress?: ExportDeps['progress']): Promise<ExportDeps> {
  const skena = vscode.workspace.getConfiguration('skena');
  const preview = vscode.workspace.getConfiguration('markdown.preview');
  const resolver = new FileResolver(await getVaults());
  return {
    assetDir: context.asAbsolutePath('dist'),
    codeTheme: skena.get<string>('code.theme') ?? 'ayu-dark',
    mdTheme: skena.get<'vscode' | 'factors'>('markdownTheme') ?? 'vscode',
    mdMaxWidth: skena.get<number>('markdownMaxWidth') ?? 0,
    mdFont: { family: preview.get<string>('fontFamily'), size: preview.get<number>('fontSize') },
    notebookShowSource: skena.get<{ showSourceCells?: boolean }>('notebook')?.showSourceCells ?? false,
    theme: (await provider.requestTheme(canvasPath)) ?? FALLBACK_THEME,
    resolveFile: (uri, dir) => {
      const r = resolver.resolve(uri, dir);
      return r && !r.isNotion ? { fsPath: r.fsPath, fileType: r.fileType } : null;
    },
    knowledgeAsset: (server, uri) => provider.knowledgeAsset(server, uri),
    fetchImage: fetchDataUrl,
    progress,
  };
}

/** Exports `canvasPath` to `outPath` (default: next to it, .html). Never throws: a failure is the reply. */
export async function exportToFile(
  context: vscode.ExtensionContext, provider: SkenaEditorProvider, canvasPath: string, outPath?: string, progress?: ExportDeps['progress'],
): Promise<ExportReply> {
  try {
    const target = outPath ?? defaultHtmlPath(canvasPath);
    const r = await exportCanvasToFile(canvasPath, target, await exportDeps(context, provider, canvasPath, progress));
    return { ok: true, outPath: target, bytes: Buffer.byteLength(r.html), nodes: r.nodes, edges: r.edges, missing: r.missing };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Skena: Export canvas to HTML": the focused canvas (else one picked), a save dialog, a progress note. */
export async function exportCommand(context: vscode.ExtensionContext, provider: SkenaEditorProvider, active: string | null): Promise<void> {
  let canvasPath = active;
  if (!canvasPath) {
    const picked = await vscode.window.showOpenDialog({ filters: { 'Canvas files': ['canvas'] }, canSelectMany: false });
    canvasPath = picked?.[0]?.fsPath ?? null;
  }
  if (!canvasPath) return;
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultHtmlPath(canvasPath)), filters: { HTML: ['html'] } });
  if (!target) return;
  const from = canvasPath;
  const reply = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Skena: exporting ${path.basename(from)}` },
    p => exportToFile(context, provider, from, target.fsPath, (done, total) => p.report({ message: `${done}/${total} nodes`, increment: 100 / total })),
  );
  if (!reply.ok) { void vscode.window.showErrorMessage(`Skena: export failed: ${reply.error}`); return; }
  const missing = reply.missing.length ? `; ${reply.missing.length} images could not be read (their address is shown instead)` : '';
  const choice = await vscode.window.showInformationMessage(
    `Skena: exported ${reply.nodes} nodes to ${path.basename(reply.outPath)} (${(reply.bytes / 1e6).toFixed(1)} MB)${missing}`, 'Open in browser',
  );
  if (choice) void vscode.env.openExternal(vscode.Uri.file(reply.outPath));
}
