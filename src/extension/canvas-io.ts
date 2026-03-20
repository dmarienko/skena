/**
 * Read and write JSON Canvas 1.0 files.
 * Handles Skena extension node types (cell, chat, portal) transparently.
 */

import * as fs from 'fs/promises';
import { CanvasData } from '../shared/types';

/** - read and parse a .canvas file */
export async function readCanvas(fsPath: string): Promise<CanvasData> {
  const raw = await fs.readFile(fsPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<CanvasData>;
  return {
    nodes: parsed.nodes ?? [],
    edges: parsed.edges ?? [],
  };
}

/** - write canvas data back to disk */
export async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(fsPath, json, 'utf-8');
}

/** - create a new empty canvas file */
export async function createCanvas(fsPath: string): Promise<void> {
  const empty: CanvasData = { nodes: [], edges: [] };
  await writeCanvas(fsPath, empty);
}
