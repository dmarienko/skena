/**
 * Where the joined document Pylance reads lives (go to definition): a .py file per canvas and text
 * under the per-user temporary folder (ipcEndpoint userTempDir), outside every project. A file is
 * named by a hash of the canvas path and a hash of its text and written once, so the document VS Code
 * opens from it is never edited (no save prompt, nothing for hot exit) and always has the text it was
 * written with. Past KEEP files of one canvas the oldest are deleted. No vscode import.
 */
import { createHash } from 'crypto';
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

/**
 * The joined file of `text` for `canvasPath`, written when it is not there yet (owner-only); then all
 * but the KEEP newest of this canvas's files are deleted. `tmp` (tests) stands for the OS temp dir.
 */
export function writeJoinedFile(canvasPath: string, text: string, tmp?: string): string {
  const dir = path.join(userTempDir(tmp), 'definition');
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const name = joinedFileName(canvasPath, text);
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text, { mode: 0o600 });
  else fs.utimesSync(file, new Date(), new Date());
  const prefix = name.slice(0, name.lastIndexOf('-') + 1);
  const own = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.py'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of own.slice(KEEP)) if (f !== name) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
