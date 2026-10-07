/**
 * Go to definition from a code cell, the host's half. findDefinitions asks Pylance about the canvas's
 * code cells joined in run order, then, when Pylance finds nothing, the cell's kernel if it is running
 * and idle. showDefinitions opens what the webview hands back: one file in the editor group beside
 * the canvas, or a quick pick of several places.
 */
import * as os from 'os';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { CanvasData, CodeNode, HostToWebview, MsgGoToDefinition } from '../../shared/types';
import {
  codeCellsInRunOrder, joinCells, pickEntry, targetsFromKernel, targetsFromLocations, toJoined,
  type DefinitionTarget, type JoinCell, type KernelDefinition,
} from '../../shared/goToDefinition';
import { cellKernelView, kernelById, resolveCellKernel } from '../../shared/kernelBinding';
import { DEFINITION_KEY, DEFINITION_TIMEOUT_MS, definitionExpression, parseDefinitionValue } from '../jupyter/definitionSnippet';
import type { KernelManager } from '../jupyter/manager';
import { writeJoinedFile } from './joinedFile';
import { hasPylance, pylanceLocations } from './pylanceLocations';

// - `# type: ignore` first: Pylance reports no problems for the joined file (pyright: a file-level ignore)
export const JOINED_HEADER = ['# type: ignore', '# - skena: the code cells of one canvas in run order, for go to definition and find references'];

/** - the canvas's Python code cells in run order, the asking cell with its live text */
export function canvasCells(canvas: CanvasData, cellId: string, liveCode: string): JoinCell[] {
  const nodes = canvas.nodes as (CodeNode & { type: string })[];
  const byId = new Map(nodes.map(n => [n.id, n]));
  return codeCellsInRunOrder(nodes, canvas.metadata?.sections ?? [])
    .map(id => ({ id, code: id === cellId ? liveCode : (byId.get(id)?.code ?? '') }));
}

// - the kernel's answer for `name`, or null: no kernel, not idle, no reply in time, no source
async function kernelDefinition(name: string, cellId: string, canvas: CanvasData, manager: KernelManager): Promise<KernelDefinition | null> {
  const kid = resolveCellKernel(cellId, cellKernelView(canvas));
  const kernel = kid ? kernelById(canvas, kid) : null;
  const server = kernel ? manager.serverByName(kernel.server) : undefined;
  if (!kernel?.kernelId || !server) return null;
  // - never queue behind a running cell
  if (!(await manager.isIdle(server, kernel.kernelId))) return null;
  const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
  const ue = await manager.evaluate(server, kernel.kernelId, { [DEFINITION_KEY]: definitionExpression(name) }, ids, DEFINITION_TIMEOUT_MS);
  const answer = parseDefinitionValue(ue?.[DEFINITION_KEY]);
  return answer.ok ? answer.def : null;
}

// - only the Pylance step's first failure in this window is logged
let pylanceFailed = false;

/**
 * - where the name at the request's cursor is defined: Pylance first, the kernel when Pylance finds
 *   nothing or its step fails (the joined file cannot be written or opened)
 */
export async function findDefinitions(msg: MsgGoToDefinition, canvas: CanvasData, canvasPath: string, manager: KernelManager): Promise<DefinitionTarget[]> {
  const cells = canvasCells(canvas, msg.cellNodeId, msg.code);
  const joined = joinCells(cells, JOINED_HEADER);
  const cursor = toJoined(joined, msg.cellNodeId, msg.line, msg.col);
  if (cursor && hasPylance()) {
    try {
      const { uri, locs } = await pylanceLocations('vscode.executeDefinitionProvider', writeJoinedFile(canvasPath, joined.text), cursor);
      const targets = targetsFromLocations(locs, uri, joined, cursor);
      if (targets.length > 0) return targets;
    } catch (err) {
      if (!pylanceFailed) console.warn('[skena] go to definition: Pylance step failed, asking the kernel', err);
      pylanceFailed = true;
    }
  }
  if (!msg.name) return [];
  const def = await kernelDefinition(msg.name, msg.cellNodeId, canvas, manager);
  return def ? targetsFromKernel(def, cells) : [];
}

/** - `t` in the editor group beside the canvas (created if none), cursor and view on its line and column */
async function openFileTarget(t: Extract<DefinitionTarget, { kind: 'file' }>): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(t.uri));
  const pos = new vscode.Position(t.line - 1, t.col - 1);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(pos, pos) });
}

// - the text of each target's line: a cell's from the canvas, a file's read once per file
async function lineTexts(targets: DefinitionTarget[], canvas: CanvasData): Promise<string[]> {
  const files = new Map<string, Promise<string[]>>();
  const fileLines = (uri: string) => {
    let p = files.get(uri);
    if (!p) {
      p = Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(uri)))
        .then(b => new TextDecoder().decode(b).split(/\r\n|\r|\n/), () => []);
      files.set(uri, p);
    }
    return p;
  };
  return Promise.all(targets.map(async t => {
    if (t.kind === 'file') return (await fileLines(t.uri))[t.line - 1] ?? '';
    const cell = canvas.nodes.find(n => n.id === t.cellId) as CodeNode | undefined;
    return (cell?.code ?? '').split(/\r\n|\r|\n/)[t.line - 1] ?? '';
  }));
}

/** - one file target opens beside the canvas; several go to a quick pick, and a picked cell back to the webview */
export async function showDefinitions(targets: DefinitionTarget[], canvas: CanvasData, send: (m: HostToWebview) => void): Promise<void> {
  if (targets.length === 0) return;
  if (targets.length === 1 && targets[0].kind === 'file') { await openFileTarget(targets[0]); return; }
  const texts = await lineTexts(targets, canvas);
  const labelOf = (id: string) => canvas.nodes.find(n => n.id === id)?.nodeLabel ?? id;
  const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const items = targets.map((t, i) => ({
    ...pickEntry(t, texts[i], labelOf, uri => vscode.Uri.parse(uri).fsPath, roots, os.homedir()),
    target: t,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Go to definition', matchOnDescription: true });
  if (!picked) return;
  const t = picked.target;
  if (t.kind === 'file') await openFileTarget(t);
  else send({ type: 'definitionGoto', cellNodeId: t.cellId, line: t.line, col: t.col });
}
