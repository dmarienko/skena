/**
 * An open editor's hold on its .canvas file. Every write of the file by the editor host goes through
 * `commit` or `save`, every reload through `absorb`, and they run one at a time. A host change to its
 * canvas is made inside `commit`, on the canvas as it is then, so no save can replace it unwritten.
 *
 * The rule: the host remembers the exact text it last wrote to or read from the file, and a version
 * number that moves on with each. Before writing, it reads the file again. Text other than what it
 * remembers means another writer (the MCP server, git, Obsidian) changed the file since, and that
 * change is merged into the host's canvas (merge3) before anything is written, never written over.
 * The read and the write happen holding the canvas's lock file (canvasLock.ts), which every other
 * writer takes too, so nothing lands between them.
 * The webview's save carries the version its canvas is based on, and a save based on any version
 * but the current one is refused: the webview is sent the current canvas instead, merges its own
 * changes into it and saves again.
 */
import type { CanvasData } from '../shared/types';
import { merge3 } from '../shared/canvasMerge';
import { parseCanvas } from './canvas-io';
import { lockWasLost } from './canvasLock';

export interface CanvasFileIO {
  /** - the file's text, or null when it cannot be read */
  read(fsPath: string): Promise<string | null>;
  /** - `held`, when given, is called right before the rename and throws when the lock is no longer ours */
  write(fsPath: string, json: string, held?: () => Promise<void>): Promise<void>;
  /** - runs `fn` holding the canvas's lock (withCanvasLock); rejects, without running it, when the lock cannot be had */
  lock<T>(fsPath: string, fn: (held: () => Promise<void>) => Promise<T>): Promise<T>;
}

export interface Loaded { canvas: CanvasData; version: number }
export interface Committed<R = void> { canvas: CanvasData; version: number; prevVersion: number; merged: boolean; result: R }
export type Saved =
  | { written: true; version: number; prevVersion: number }
  | { written: false; canvas: CanvasData; version: number };

// - a write whose lock was taken over before its rename is made again holding a new one, this many times in all
const LOCK_ATTEMPTS = 3;

// - a file another writer is writing in place (the MCP server truncates, then writes) is read again
//   this often, this far apart, until it parses
const SETTLE_TRIES = 40;
const SETTLE_MS = 25;

export class CanvasFile {
  private version = 0;
  // - the file's exact text at `version`
  private knownRaw: string | null = null;
  // - the host's canvas at `version`, serialised: the base of a merge
  private knownJson = '';
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fsPath: string,
    private readonly io: CanvasFileIO,
    /** - the canvas as the editor holds it, from the canvas in the file (openedCanvas) */
    private readonly open: (fromFile: CanvasData, was?: CanvasData) => CanvasData,
    private readonly get: () => CanvasData,
    private readonly set: (c: CanvasData) => void,
  ) {}

  // - `fn` holding the lock; again, holding a new lock, when the lock was lost before its write
  private async locked<T>(fn: (held: () => Promise<void>) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.io.lock(this.fsPath, fn);
      } catch (e) {
        if (!lockWasLost(e) || attempt >= LOCK_ATTEMPTS) throw e;
      }
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  /** The file as the editor opens it; throws when it cannot be read or parsed. */
  load(): Promise<Loaded> {
    return this.serial(async () => {
      const raw = await this.io.read(this.fsPath);
      if (raw === null) throw new Error(`cannot read ${this.fsPath}`);
      const canvas = this.open(parseCanvas(raw));
      this.set(canvas);
      this.knownRaw = raw;
      this.knownJson = JSON.stringify(canvas);
      return { canvas, version: ++this.version };
    });
  }

  /**
   * Take in what another writer changed in the file, merged into the host's canvas. Null when the
   * file holds what the host already knows, or does not parse yet (a writer mid-write: its next
   * change event reads it again).
   */
  absorb(): Promise<Loaded | null> {
    return this.serial(() => this.absorbNow());
  }

  // - the file's text and canvas once it parses; null canvas = unchanged, unreadable, or still mid-write
  private async readSettled(): Promise<{ raw: string; canvas: CanvasData } | null> {
    for (let i = 0; ; i++) {
      const raw = await this.io.read(this.fsPath);
      if (raw === null || raw === this.knownRaw) return null;
      // - an empty file where the host knew content is a writer that has truncated it and not yet written
      if (raw.trim() !== '' || !this.knownRaw?.trim()) {
        try { return { raw, canvas: parseCanvas(raw) }; } catch { /* - half written */ }
      }
      if (i >= SETTLE_TRIES) return null;
      await new Promise(r => setTimeout(r, SETTLE_MS));
    }
  }

  private async absorbNow(): Promise<Loaded | null> {
    const read = await this.readSettled();
    if (!read) return null;
    const { raw, canvas: fromFile } = read;
    const theirs = this.open(fromFile, this.get());
    // - the host's canvas can hold a change not yet written (a mutation whose commit is queued behind this)
    const merged = this.knownRaw === null ? theirs : merge3(JSON.parse(this.knownJson) as CanvasData, this.get(), theirs).canvas;
    this.set(merged);
    this.knownRaw = raw;
    this.knownJson = JSON.stringify(theirs);
    return { canvas: merged, version: ++this.version };
  }

  private async writeNow(c: CanvasData, held?: () => Promise<void>): Promise<{ version: number; prevVersion: number }> {
    const json = JSON.stringify(c, null, 2);
    await this.io.write(this.fsPath, json, held);
    this.knownRaw = json;
    this.knownJson = json;
    const prevVersion = this.version;
    return { version: ++this.version, prevVersion };
  }

  /**
   * Make a host change with `change` and write the host's canvas. What another writer changed in the
   * file since is merged in first, so `change` sees it; `merged` then says the editor has to be sent the
   * result: it has not seen that change. `result` is what `change` returned.
   */
  commit<R = void>(change?: (c: CanvasData) => R): Promise<Committed<R>> {
    return this.serial(() => {
      // - made once: a write made again (its lock lost) writes the canvas the change was made on
      let made = false, merged = false;
      let result = undefined as R;
      return this.locked(async held => {
        if (await this.absorbNow()) merged = true;
        if (!made) { result = change ? change(this.get()) : (undefined as R); made = true; }
        // - a change may have replaced the canvas object rather than edited it
        const written = this.get();
        const { version, prevVersion } = await this.writeNow(written, held);
        return { canvas: written, version, prevVersion, merged, result };
      });
    });
  }

  /**
   * The webview's save: written when it is based on the current version (`build` makes the canvas to
   * write, from the host's canvas as it is then). Otherwise nothing is written and the current canvas
   * comes back for the webview.
   */
  save(baseVersion: number | undefined, build: () => CanvasData): Promise<Saved> {
    return this.serial(() => this.locked(async held => {
      await this.absorbNow();
      if (baseVersion !== this.version) return { written: false, canvas: this.get(), version: this.version };
      const c = build();
      const v = await this.writeNow(c, held);
      this.set(c);
      return { written: true, ...v } as Saved;
    }));
  }
}
