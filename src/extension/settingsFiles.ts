/**
 * Settings files read straight from disk, by the extension and by the MCP server alike. No vscode
 * import: the MCP server is bundled and run on its own.
 */

import * as fsSync from 'fs';
import * as path   from 'path';
import type { SettingsRead } from './jupyter/config';
import { parseSettingsJson } from './settingsJson';

/**
 * The nearest folder at or above `start` that has a .vscode directory: the workspace folder the
 * extension deploys the MCP script into, as near as a process outside VS Code can tell. Null when
 * no folder up to the root has one.
 */
export function workspaceDirAbove(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    try { if (fsSync.statSync(path.join(dir, '.vscode')).isDirectory()) return dir; } catch { /* - keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** One settings file, read synchronously: its parsed content, or why there is none. Never throws. */
export function readSettingsSync(file: string): SettingsRead {
  let raw: string;
  try { raw = fsSync.readFileSync(file, 'utf-8'); }
  catch (e) { return { file, problem: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'not readable' }; }
  try { return { file, json: parseSettingsJson(raw) }; }
  catch (e) { return { file, problem: e instanceof Error ? e.message : String(e) }; }
}
