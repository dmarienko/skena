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
  const raw     = await fs.readFile(expandHome(fsPath), 'utf-8');
  const trimmed = raw.trim();
  // - empty file (e.g. newly created by VS Code "New File") → treat as blank canvas
  if (!trimmed) {
    return { nodes: [], edges: [] };
  }
  const parsed = JSON.parse(trimmed) as Partial<CanvasData>;
  return {
    nodes:           parsed.nodes           ?? [],
    edges:           parsed.edges           ?? [],
    viewport:        parsed.viewport,
    creationCounter: parsed.creationCounter,
    metadata:        parsed.metadata,
  };
}

/**
 * Write a .canvas file atomically. A reader (the file-watcher / webview) must never see a
 * truncated file: writeFile truncates then streams, so a concurrent read of this large .canvas
 * can catch it empty and the webview would take an empty reload. We write a PID+timestamp-named
 * temp sibling, then rename (atomic on the same filesystem), so readers only ever see the
 * complete old or complete new file. (The MCP server writes non-atomically on purpose — its
 * watcher reload needs IN_CLOSE_WRITE; the webview's empty-reload guard covers that rarer path.)
 */
export async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const target = expandHome(fsPath);
  // - ATOMIC write: a reader (the file-watcher) must never see a truncated/partial file. writeFile
  //   truncates then streams, so a concurrent read of this large .canvas can catch it empty → the
  //   webview gets an empty reload and collapses/loses nodes. Write a temp sibling, then rename
  //   (atomic on the same filesystem) so readers only ever see the complete old or complete new file.
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, json, 'utf-8');
  await fs.rename(tmp, target);
}

/** - create a new empty canvas file */
export async function createCanvas(fsPath: string): Promise<void> {
  const empty: CanvasData = { nodes: [], edges: [] };
  await writeCanvas(fsPath, empty);
}
