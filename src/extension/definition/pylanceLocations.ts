/**
 * Pylance's answer at a position of the joined file: where the name there is defined
 * (vscode.executeDefinitionProvider) or every reference of it (vscode.executeReferenceProvider).
 * Pylance may answer nothing while it starts or reads a file it has just been given, so for a file not
 * asked about before in this window an empty answer is asked again every RETRY_MS until WAIT_MS has
 * passed; a file asked about before gets one call. Without Pylance installed there is no answer.
 */
import * as vscode from 'vscode';
import type { DocPos } from '../../shared/goToDefinition';

/**
 * - from the spike (Task 1, 2026-10-07, factors window): a fresh joined file's first answer came in
 *   164-249 ms, the window's first lookup (an untitled document) in 581 ms, and no call came back empty
 */
export const RETRY_MS = 250;
export const WAIT_MS = 600;

export type PylanceCommand = 'vscode.executeDefinitionProvider' | 'vscode.executeReferenceProvider';

/** - one location of an answer: its document's URI string, 0-based start and end */
export interface PylanceLocation { uri: string; line: number; character: number; endLine: number; endCharacter: number }

const PYLANCE = 'ms-python.vscode-pylance';
// - the joined files asked about in this window
const asked = new Set<string>();

function toLocation(l: vscode.Location | vscode.LocationLink): PylanceLocation {
  const uri = l instanceof vscode.Location ? l.uri : l.targetUri;
  const r = l instanceof vscode.Location ? l.range : l.targetSelectionRange ?? l.targetRange;
  return { uri: uri.toString(), line: r.start.line, character: r.start.character, endLine: r.end.line, endCharacter: r.end.character };
}

/** - the file's URI string (to tell its own locations apart) and Pylance's answer to `command` at `pos` in it */
export async function pylanceLocations(command: PylanceCommand, file: string, pos: DocPos): Promise<{ uri: string; locs: PylanceLocation[] }> {
  const uri = vscode.Uri.file(file);
  if (!vscode.extensions.getExtension(PYLANCE)) return { uri: uri.toString(), locs: [] };
  const doc = await vscode.workspace.openTextDocument(uri);
  const at = new vscode.Position(pos.line, pos.character);
  const end = Date.now() + (asked.has(file) ? 0 : WAIT_MS);
  asked.add(file);
  for (;;) {
    const raw = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(command, doc.uri, at);
    const locs = (raw ?? []).map(toLocation);
    if (locs.length > 0 || Date.now() >= end) return { uri: doc.uri.toString(), locs };
    await new Promise(resolve => setTimeout(resolve, RETRY_MS));
  }
}
