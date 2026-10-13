/**
 * One lock per .canvas file, taken by every process that writes it: the editor host (canvasFile.ts) and
 * each MCP server (mcp/server.ts). A writer holds it from its read of the file to the end of its write,
 * so no other writer's change can land between the read its merge is based on and the rename.
 *
 * The lock is the file `<canvas real path>.lock`, created with O_EXCL and holding the holder's pid,
 * host name, start time and a token. Next to the canvas, not in a temp or runtime folder: the canvas
 * path is the one thing both processes are sure to agree on (TMPDIR and XDG_RUNTIME_DIR come from each
 * process's own environment); the real path makes a symlinked route to the same file agree too.
 *
 * Waiting retries with a growing pause (2 ms up to 50 ms) for at most LOCK_WAIT_MS, then gives up with
 * CanvasLockTimeout and the work is not done. A lock is broken when its process is gone (same host) or
 * when it is older than LOCK_STALE_MS; the longest hold measured on a 4.5 MB canvas is well under a second.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const LOCK_WAIT_MS = 15_000;
export const LOCK_STALE_MS = 10_000;

export class CanvasLockTimeout extends Error {}

interface Holder { pid: number; host: string; at: number; by: string; token: string }

/** - the lock file of a canvas: next to its real path; a canvas not created yet goes by its folder's real path */
export async function lockPathFor(fsPath: string): Promise<string> {
  const abs = path.resolve(fsPath);
  try {
    return `${await fs.realpath(abs)}.lock`;
  } catch {
    let dir = path.dirname(abs);
    try { dir = await fs.realpath(dir); } catch { /* - folder missing too: the plain path */ }
    return `${path.join(dir, path.basename(abs))}.lock`;
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

// - what is in the lock file now: its text and holder, or null when it is gone
async function readLock(lock: string): Promise<{ raw: string; holder: Holder | null; mtime: number } | null> {
  try {
    const [raw, st] = await Promise.all([fs.readFile(lock, 'utf-8'), fs.stat(lock)]);
    let holder: Holder | null = null;
    try { holder = JSON.parse(raw) as Holder; } catch { /* - created, not yet written */ }
    return { raw, holder, mtime: st.mtimeMs };
  } catch { return null; }
}

function stale(l: { holder: Holder | null; mtime: number }, staleMs: number, now: number): boolean {
  const at = l.holder?.at ?? l.mtime;
  if (now - at > staleMs) return true;
  return !!l.holder && l.holder.host === os.hostname() && !alive(l.holder.pid);
}

// - take a stale lock away: moved aside under a name of our own, so of two writers breaking it only one
//   succeeds. Had a fresh lock replaced the stale one by then, it goes back where it was.
async function breakLock(lock: string, seen: string, token: string): Promise<void> {
  const aside = `${lock}.${token}.broken`;
  try { await fs.rename(lock, aside); } catch { return; }
  const moved = await fs.readFile(aside, 'utf-8').catch(() => seen);
  if (moved !== seen) await fs.link(aside, lock).catch(() => undefined);
  await fs.rm(aside, { force: true });
}

function describe(h: Holder | null): string {
  return h ? `${h.by} (pid ${h.pid} on ${h.host}, since ${new Date(h.at).toISOString()})` : 'an unknown writer';
}

/**
 * Run `fn` holding the canvas's lock; `by` names this writer in the lock file. Throws CanvasLockTimeout,
 * without running `fn`, when the lock cannot be had within `waitMs`.
 */
export async function withCanvasLock<T>(
  fsPath: string,
  by: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number; staleMs?: number } = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const lock = await lockPathFor(fsPath);
  const token = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + waitMs;
  for (let pause = 2; ; pause = Math.min(pause * 2, 50)) {
    try {
      const h = await fs.open(lock, 'wx');
      try {
        const me: Holder = { pid: process.pid, host: os.hostname(), at: Date.now(), by, token };
        await h.writeFile(JSON.stringify(me));
      } finally { await h.close(); }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const held = await readLock(lock);
    if (held && stale(held, staleMs, Date.now())) { await breakLock(lock, held.raw, token); continue; }
    if (Date.now() >= deadline) {
      throw new CanvasLockTimeout(`${path.basename(fsPath)} is locked by ${describe(held?.holder ?? null)}; waited ${waitMs} ms, nothing written`);
    }
    await new Promise(r => setTimeout(r, pause));
  }
  try {
    return await fn();
  } finally {
    // - only our own lock: one broken as stale and taken by another writer is theirs now
    const now = await readLock(lock);
    if (now?.holder?.token === token) await fs.rm(lock, { force: true });
  }
}
