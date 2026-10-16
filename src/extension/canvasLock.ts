/**
 * One lock per .canvas file, taken by every process that writes it: the editor host (canvasFile.ts) and
 * each MCP server (mcp/server.ts). A writer holds it from its read of the file to the end of its write,
 * so no other writer's change can land between the read its merge is based on and the rename.
 *
 * The lock is a file in /tmp/skena-<uid>/locks named from the canvas's real path, created with O_EXCL
 * and holding the holder's pid, host name, start time and a token. The folder is fixed rather than
 * os.tmpdir() or $XDG_RUNTIME_DIR, which come from each process's own environment: two processes that
 * named different folders would each take a lock of their own. The real path makes a symlinked route
 * to the same file agree too. A canvas on a network folder written from two machines is not covered.
 *
 * - Holding: the holder touches the lock file's mtime every LOCK_HEARTBEAT_MS, so a slow live holder
 *   never looks stale. `held()`, given to the work, says whether the lock still holds our token; a
 *   writer calls it right before its rename and does not write when it does not (CanvasLockLost).
 * - Waiting: retries with a growing pause (2 ms up to 50 ms) for at most LOCK_WAIT_MS, then gives up
 *   with CanvasLockTimeout and the work is not done.
 * - Stale: a lock whose mtime is older than LOCK_STALE_MS, or whose process is gone (same host).
 * - Breaking: one breaker at a time, holding `<lock>.break` (O_EXCL; one older than BREAK_STALE_MS was
 *   left by a crashed breaker and is cleared). It removes the lock only while the file is still the very
 *   stale file it looked at (same text and mtime), by moving it aside and checking the moved file; a
 *   file that changed in between goes back.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { ownDir, userName } from './ipcEndpoint';

export const LOCK_WAIT_MS = 15_000;
export const LOCK_STALE_MS = 10_000;
export const LOCK_HEARTBEAT_MS = 1_000;
const BREAK_STALE_MS = 2_000;

export class CanvasLockTimeout extends Error {}
/** - the lock was broken and taken while this writer held it: it must not write */
export class CanvasLockLost extends Error {
  override name = 'CanvasLockLost';
}

/** - an error that says the write was not made because the lock was taken over (by name: bundles each carry their own class) */
export const lockWasLost = (e: unknown): boolean => (e as Error | null)?.name === 'CanvasLockLost';

interface Holder { pid: number; host: string; at: number; by: string; token: string }
/** - a lock file as one look at it found it */
export interface LockSeen { raw: string; holder: Holder | null; mtime: number }

/**
 * - the folder every lock is in, created owner-only; throws when it is a link or another user's.
 *   Windows has no /tmp and no uids: skena-<user> in its temp folder.
 */
export function lockDir(): string {
  const uid = process.getuid?.();
  const base = uid === undefined ? path.join(os.tmpdir(), `skena-${userName()}`) : path.join('/tmp', `skena-${uid}`);
  ownDir(base);
  const dir = path.join(base, 'locks');
  ownDir(dir);
  return dir;
}

// - a canvas not created yet goes by its folder's real path, so its lock is the same before and after
async function realCanvasPath(fsPath: string): Promise<string> {
  const abs = path.resolve(fsPath);
  try {
    return await fs.realpath(abs);
  } catch {
    let dir = path.dirname(abs);
    try { dir = await fs.realpath(dir); } catch { /* - folder missing too: the plain path */ }
    return path.join(dir, path.basename(abs));
  }
}

/** - the lock file of a canvas: its name, then a hash of its real path */
export async function lockPathFor(fsPath: string): Promise<string> {
  const real = await realCanvasPath(fsPath);
  // - folders that ignore case by default: two spellings must share a lock; sharing one needlessly only makes a writer wait
  const key = process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return path.join(lockDir(), `${path.basename(real).slice(0, 80)}.${hash}.lock`);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** - what is in the lock file now, or null when there is none */
export async function inspectLock(lock: string): Promise<LockSeen | null> {
  try {
    const st = await fs.stat(lock);
    const raw = await fs.readFile(lock, 'utf-8');
    let holder: Holder | null = null;
    try { holder = JSON.parse(raw) as Holder; } catch { /* - created, not yet written */ }
    return { raw, holder, mtime: st.mtimeMs };
  } catch { return null; }
}

function stale(l: LockSeen, staleMs: number, now: number): boolean {
  if (now - l.mtime > staleMs) return true;
  return !!l.holder && l.holder.host === os.hostname() && !alive(l.holder.pid);
}

const sameFile = (a: LockSeen | null, b: LockSeen) => !!a && a.raw === b.raw && a.mtime === b.mtime;

/**
 * Remove the stale lock `seen` describes, and nothing else. True when it was removed (or was already gone).
 */
export async function breakStale(lock: string, seen: LockSeen, token: string): Promise<boolean> {
  const brk = `${lock}.break`;
  try {
    await (await fs.open(brk, 'wx')).close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    try {
      const st = await fs.stat(brk);
      if (Date.now() - st.mtimeMs > BREAK_STALE_MS) await fs.rm(brk, { force: true });
    } catch { /* - gone meanwhile */ }
    return false;
  }
  try {
    const now = await inspectLock(lock);
    if (!now) return true;
    if (!sameFile(now, seen)) return false;   // - replaced or refreshed since the look: not stale, or not that one
    const aside = `${lock}.${token}.broken`;
    try { await fs.rename(lock, aside); } catch { return true; }
    // - only its own holder can have touched it in between (breakers wait on the break file): then it lives,
    //   and goes back, unless a new lock has taken the place already
    if (!sameFile(await inspectLock(aside), seen)) {
      await fs.link(aside, lock).catch(() => undefined);
      await fs.rm(aside, { force: true });
      return false;
    }
    await fs.rm(aside, { force: true });
    return true;
  } finally {
    await fs.rm(brk, { force: true });
  }
}

function describe(h: Holder | null): string {
  return h ? `${h.by} (pid ${h.pid} on ${h.host}, since ${new Date(h.at).toISOString()})` : 'an unknown writer';
}

/**
 * Run `fn` holding the canvas's lock; `by` names this writer in the lock file. `fn` gets `held()`, which
 * throws CanvasLockLost once the lock no longer holds our token. Throws CanvasLockTimeout, without running
 * `fn`, when the lock cannot be had within `waitMs`.
 */
export async function withCanvasLock<T>(
  fsPath: string,
  by: string,
  fn: (held: () => Promise<void>) => Promise<T>,
  opts: { waitMs?: number; staleMs?: number; heartbeatMs?: number } = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const heartbeatMs = opts.heartbeatMs ?? LOCK_HEARTBEAT_MS;
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
    const seen = await inspectLock(lock);
    if (seen && stale(seen, staleMs, Date.now()) && await breakStale(lock, seen, token)) continue;
    if (Date.now() >= deadline) {
      throw new CanvasLockTimeout(`${path.basename(fsPath)} is locked by ${describe(seen?.holder ?? null)}; waited ${waitMs} ms, nothing written`);
    }
    await new Promise(r => setTimeout(r, pause));
  }
  const ours = async () => (await inspectLock(lock))?.holder?.token === token;
  const beat = setInterval(() => {
    void (async () => {
      if (!await ours()) return;
      const t = new Date();
      await fs.utimes(lock, t, t).catch(() => undefined);
    })();
  }, heartbeatMs);
  beat.unref?.();
  const held = async () => {
    if (!await ours()) throw new CanvasLockLost(`the lock on ${path.basename(fsPath)} was taken over; nothing written`);
  };
  try {
    return await fn(held);
  } finally {
    clearInterval(beat);
    // - only our own lock: one broken as stale and taken by another writer is theirs now
    if (await ours()) await fs.rm(lock, { force: true });
  }
}
