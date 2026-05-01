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
    nodes:    parsed.nodes    ?? [],
    edges:    parsed.edges    ?? [],
    viewport: parsed.viewport,
  };
}

/**
 * Write canvas data back to disk.
 *
 * Direct write (not atomic rename) is intentional here: the extension is the
 * primary owner of open canvas files and uses the `isSelfSaving` flag in
 * resolveCustomEditor to suppress its own file-watcher reload cycle.
 * Atomic rename would use the same `.tmp` name as the MCP server, risking a
 * collision when both write near-simultaneously.
 */
export async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(expandHome(fsPath), json, 'utf-8');
}

/** - create a new empty canvas file */
export async function createCanvas(fsPath: string): Promise<void> {
  const empty: CanvasData = { nodes: [], edges: [] };
  await writeCanvas(fsPath, empty);
}
