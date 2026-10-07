/**
 * Find references from a code cell, the host's half: Pylance's references at the cursor's place in the
 * canvas's code cells joined in run order (the same joined file as go to definition), as places in
 * cells and files, with the text of each cell and file they are in for the webview's peek. Pylance
 * only; the kernel is not asked.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { CanvasData, MsgFindReferences } from '../../shared/types';
import { joinCells, toJoined } from '../../shared/goToDefinition';
import { referencesFromLocations, type PeekFile, type ReferencesAnswer } from '../../shared/findReferences';
import { JOINED_HEADER, canvasCells } from './goToDefinition';
import { writeJoinedFile } from './joinedFile';
import { hasPylance, pylanceLocations } from './pylanceLocations';

// - the text Pylance read: an open document's (it may be edited and unsaved), else the file's on disk.
//   openTextDocument is not used for the others: it would open them for Pylance, which then lists their
//   problems
async function documentText(uri: string): Promise<string | null> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
  } catch {
    return null;
  }
}

/** - every reference of the name at the request's cursor; none when Pylance has none */
export async function findReferences(msg: MsgFindReferences, canvas: CanvasData, canvasPath: string): Promise<ReferencesAnswer> {
  const cells = canvasCells(canvas, msg.cellNodeId, msg.code);
  const joined = joinCells(cells, JOINED_HEADER);
  const cursor = toJoined(joined, msg.cellNodeId, msg.line, msg.col);
  if (!cursor || !hasPylance()) return { targets: [], cells: [], files: [] };
  const file = writeJoinedFile(canvasPath, joined.text);
  const { uri, locs } = await pylanceLocations('vscode.executeReferenceProvider', file, cursor);
  const targets = referencesFromLocations(locs, uri, `${vscode.Uri.file(path.dirname(file)).toString()}/`, joined);
  const order = new Map(cells.map((c, i) => [c.id, i]));
  const labelOf = (id: string) => canvas.nodes.find(n => n.id === id)?.nodeLabel ?? id;
  const cellIds = [...new Set(targets.flatMap(t => (t.kind === 'cell' ? [t.cellId] : [])))];
  const fileUris = [...new Set(targets.flatMap(t => (t.kind === 'file' ? [t.uri] : [])))];
  const files = await Promise.all(fileUris.map(async u => ({ uri: u, text: await documentText(u) })));
  return {
    targets,
    cells: cellIds.flatMap(id => {
      const i = order.get(id);
      return i === undefined ? [] : [{ id, label: labelOf(id), order: i, code: cells[i].code }];
    }),
    files: files.filter((f): f is PeekFile => f.text !== null),
  };
}
