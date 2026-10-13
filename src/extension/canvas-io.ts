/**
 * Read and write JSON Canvas 1.0 files.
 * Handles Skena extension node types (cell, chat, portal) transparently.
 */

import * as fs   from 'fs/promises';
import * as path from 'path';
import * as os   from 'os';
import { CanvasData } from '../shared/types';

// - expand leading ~ to home directory
function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** - read and parse a .canvas file */
export async function readCanvas(fsPath: string): Promise<CanvasData> {
  return parseCanvas(await fs.readFile(expandHome(fsPath), 'utf-8'));
}

/** - the canvas a .canvas file's text holds; throws on text that is not JSON */
export function parseCanvas(raw: string): CanvasData {
  const trimmed = raw.trim();
  // - empty file (e.g. newly created by VS Code "New File") → treat as blank canvas
  if (!trimmed) {
    return { nodes: [], edges: [] };
  }
  const parsed = JSON.parse(trimmed) as Partial<CanvasData>;
  return {
    nodes:    parsed.nodes ?? [],
    edges:    parsed.edges ?? [],
    viewport: parsed.viewport,
    metadata: parsed.metadata,
  };
}

/**
 * Write a .canvas file atomically. A reader (the file-watcher / webview) must never see a
 * truncated file: writeFile truncates then streams, so a concurrent read of this large .canvas
 * can catch it empty and the webview would take an empty reload. We write a PID+timestamp-named
 * temp sibling, then rename (atomic on the same filesystem), so readers only ever see the
 * complete old or complete new file. The MCP server writes through here too; the editor's watcher
 * takes a rename onto the canvas (a create event) as a change.
 */
export async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  await writeCanvasJson(fsPath, JSON.stringify(data, null, 2));
}

/**
 * writeCanvas for a canvas already serialised. `held`, when given, is asked right before the rename
 * whether the canvas lock is still ours; when it throws nothing is written.
 */
export async function writeCanvasJson(fsPath: string, json: string, held?: () => Promise<void>): Promise<void> {
  // - through a symlinked canvas to its real file: the rename would replace the link itself
  const target = await fs.realpath(expandHome(fsPath)).catch(() => expandHome(fsPath));
  // - ATOMIC write: a reader (the file-watcher) must never see a truncated/partial file. writeFile
  //   truncates then streams, so a concurrent read of this large .canvas can catch it empty → the
  //   webview gets an empty reload and collapses/loses nodes. Write a temp sibling, then rename
  //   (atomic on the same filesystem) so readers only ever see the complete old or complete new file.
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tmpSeq).toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, json, 'utf-8');
    await held?.();
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

// - two writes of one process in the same millisecond get different temp files
let tmpSeq = 0;

/** - createCanvasJson found a file where the new canvas was to go */
export class CanvasExists extends Error {}

/**
 * A new .canvas file holding `json`, never over an existing one: written to a temp sibling, then
 * hard-linked to its name, which fails when the name is taken (CanvasExists); the existing file is untouched.
 */
export async function createCanvasJson(fsPath: string, json: string): Promise<void> {
  const target = expandHome(fsPath);
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tmpSeq).toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, json, 'utf-8');
    await fs.link(tmp, target).catch(e => {
      throw (e as NodeJS.ErrnoException).code === 'EEXIST' ? new CanvasExists(`${path.basename(target)} already exists`) : e;
    });
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** - create a new empty canvas file */
export async function createCanvas(fsPath: string): Promise<void> {
  const empty: CanvasData = { nodes: [], edges: [] };
  await writeCanvas(fsPath, empty);
}
