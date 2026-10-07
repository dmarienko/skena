/**
 * Where the joined document Pylance reads lives (go to definition): a .py file per canvas and text
 * under the per-user temporary folder (ipcEndpoint userTempDir), outside every project. A file is
 * named by a hash of the canvas path and a hash of its text and written once, so the document VS Code
 * opens from it is never edited (no save prompt, nothing for hot exit) and always has the text it was
 * written with. Past KEEP files of one canvas the oldest are deleted. No vscode import.
 */
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hashPath, userTempDir } from '../ipcEndpoint';

/** - joined files kept per canvas; a lookup only ever reads the newest */
export const KEEP = 4;

/** - the file name of `text` for `canvasPath`: def-<canvas hash>-<text hash>.py */
export function joinedFileName(canvasPath: string, text: string): string {
  const h = createHash('sha1').update(text).digest('hex').slice(0, 12);
  return `def-${hashPath(path.resolve(canvasPath))}-${h}.py`;
}

const gone = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

// - `text` into `file` whole: written under a name of its own, then renamed over it, so a reader (or
//   another window writing the same file) never sees a part of it
function writeWhole(file: string, text: string): void {
  const part = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(part, text, { mode: 0o600 });
  try {
    fs.renameSync(part, file);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
}

/**
 * The joined file of `text` for `canvasPath`, written when it is not there yet (owner-only); then all
 * but the KEEP newest of this canvas's files are deleted. Another window may write and delete files
 * of the same canvas meanwhile. `tmp` (tests) stands for the OS temp dir.
 */
export function writeJoinedFile(canvasPath: string, text: string, tmp?: string): string {
  const dir = path.join(userTempDir(tmp), 'definition');
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const name = joinedFileName(canvasPath, text);
  const file = path.join(dir, name);
  try {
    fs.utimesSync(file, new Date(), new Date());
  } catch (e) {
    if (!gone(e)) throw e;
    writeWhole(file, text);
  }
  const prefix = name.slice(0, name.lastIndexOf('-') + 1);
  const own = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.py'))
    .flatMap(f => {
      try { return [{ f, t: fs.statSync(path.join(dir, f)).mtimeMs }]; } catch (e) { if (gone(e)) return []; throw e; }
    })
    .sort((a, b) => b.t - a.t);
  for (const { f } of own.slice(KEEP)) if (f !== name) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
