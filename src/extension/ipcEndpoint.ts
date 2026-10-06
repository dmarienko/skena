/**
 * Where an MCP server started outside skena (Claude Code reading .mcp.json) finds the extension's
 * 127.0.0.1 relay: a file in the OS temp dir per workspace folder, owner-only, holding the relay's
 * "port:token". The extension writes it when the relay listens and removes it on dispose; an MCP
 * server started by the AI companion gets the same value in SKENA_RUN_IPC. No vscode import.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** - short stable token from a path, for temp-file naming */
export function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h * 31 + p.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

export function endpointFile(workspaceDir: string, tmp = os.tmpdir()): string {
  return path.join(tmp, `skena-ipc-${hashPath(path.resolve(workspaceDir))}.json`);
}

/** - `endpoint` is the relay's "port:token" */
export function writeEndpoint(workspaceDir: string, endpoint: string, tmp = os.tmpdir()): void {
  const file = endpointFile(workspaceDir, tmp);
  fs.writeFileSync(file, JSON.stringify({ endpoint, workspaceDir: path.resolve(workspaceDir), pid: process.pid }), { mode: 0o600 });
}

/** The "port:token" written for `workspaceDir`, or null when there is none (or it names another folder). */
export function readEndpoint(workspaceDir: string, tmp = os.tmpdir()): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(endpointFile(workspaceDir, tmp), 'utf-8')) as { endpoint?: unknown; workspaceDir?: unknown };
    return typeof j.endpoint === 'string' && j.workspaceDir === path.resolve(workspaceDir) ? j.endpoint : null;
  } catch {
    return null;
  }
}

/** - removes the file only when it still holds `endpoint`: another window may have written its own since */
export function removeEndpoint(workspaceDir: string, endpoint: string, tmp = os.tmpdir()): void {
  if (readEndpoint(workspaceDir, tmp) !== endpoint) return;
  try { fs.unlinkSync(endpointFile(workspaceDir, tmp)); } catch { /* - already gone */ }
}
