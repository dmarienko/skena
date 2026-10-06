/**
 * Where an MCP server started outside skena (Claude Code reading .mcp.json) finds the extension's
 * 127.0.0.1 relay: a file per workspace folder, owner-only, holding the relay's "port:token", in a
 * folder only this user can use: $XDG_RUNTIME_DIR/skena when that is set, else skena-<user> in the
 * OS temp dir. The extension writes it when the relay listens and removes it on dispose; an MCP
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

function userName(): string {
  try { return os.userInfo().username; } catch { return 'user'; }
}

// - the folders the file may be in, the one it is written to first; `tmp` (tests) stands for the OS temp dir alone
function endpointDirs(tmp?: string): string[] {
  const inTmp = path.join(tmp ?? os.tmpdir(), `skena-${userName()}`);
  const xdg = tmp ? undefined : process.env.XDG_RUNTIME_DIR;
  return xdg ? [path.join(xdg, 'skena'), inTmp] : [inTmp];
}

const fileName = (workspaceDir: string) => `skena-ipc-${hashPath(path.resolve(workspaceDir))}.json`;

/** - the file the endpoint of `workspaceDir` is written to */
export function endpointFile(workspaceDir: string, tmp?: string): string {
  return path.join(endpointDirs(tmp)[0], fileName(workspaceDir));
}

// - `dir`, created owner-only when new; refused when it is a link, another user's, or (once chmod
//   cannot close it) open to others. No owner checks where there are no uids (Windows).
function ownDir(dir: string): void {
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const uid = process.getuid?.();
  let st = fs.lstatSync(dir);
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) throw new Error(`${dir} is not a folder only this user can use`);
  if (uid !== undefined && (st.mode & 0o077) !== 0) {
    fs.chmodSync(dir, 0o700);
    st = fs.lstatSync(dir);
    if ((st.mode & 0o077) !== 0) throw new Error(`${dir} is not a folder only this user can use`);
  }
}

/** - `endpoint` is the relay's "port:token" */
export function writeEndpoint(workspaceDir: string, endpoint: string, tmp?: string): void {
  const dir = endpointDirs(tmp)[0];
  ownDir(dir);
  fs.writeFileSync(path.join(dir, fileName(workspaceDir)), JSON.stringify({ endpoint, workspaceDir: path.resolve(workspaceDir), pid: process.pid }), { mode: 0o600 });
}

// - the endpoint in `file`, or null: no file, another user's file, or one that names another folder
function readFile(file: string, workspaceDir: string): string | null {
  try {
    const uid = process.getuid?.();
    if (uid !== undefined && fs.statSync(file).uid !== uid) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf-8')) as { endpoint?: unknown; workspaceDir?: unknown };
    return typeof j.endpoint === 'string' && j.workspaceDir === path.resolve(workspaceDir) ? j.endpoint : null;
  } catch {
    return null;
  }
}

/** The "port:token" written for `workspaceDir`, or null when there is none (or it names another folder, or another user wrote it). */
export function readEndpoint(workspaceDir: string, tmp?: string): string | null {
  for (const dir of endpointDirs(tmp)) {
    const endpoint = readFile(path.join(dir, fileName(workspaceDir)), workspaceDir);
    if (endpoint) return endpoint;
  }
  return null;
}

/** - removes the file only when it still holds `endpoint`: another window may have written its own since */
export function removeEndpoint(workspaceDir: string, endpoint: string, tmp?: string): void {
  for (const dir of endpointDirs(tmp)) {
    const file = path.join(dir, fileName(workspaceDir));
    if (readFile(file, workspaceDir) !== endpoint) continue;
    try { fs.unlinkSync(file); } catch { /* - already gone */ }
  }
}
