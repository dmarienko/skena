/**
 * Path helpers shared by the file resolver, the vault watcher and the canvas panel's change
 * notices. No vscode import, so tests can load it in plain node.
 */

import * as fs from 'fs';
import * as path from 'path';

// - paths the vault watcher never reports: any entry whose name starts with a dot, and anything inside
// - a node_modules, __pycache__ or dist folder
export const WATCH_IGNORED = /(^|[/\\])\..|(^|[/\\])(node_modules|__pycache__|dist)([/\\]|$)/;

/**
 * The absolute folder of a configured vault path: a leading ~ is the home folder, and
 * path.resolve drops a trailing slash, so '~/projects/crtx/' and '~/projects/crtx' agree.
 */
export function vaultRoot(configured: string, home: string | undefined): string {
  const expanded = configured.startsWith('~') ? path.join(home ?? '~', configured.slice(1)) : configured;
  return path.resolve(expanded);
}

/**
 * The vault:// uri of a file, from the vault with the longest root that holds it; null when no vault
 * holds it. Roots are [name, folder] pairs.
 */
export function vaultUriFor(roots: Iterable<[string, string]>, fsPath: string): string | null {
  const file = path.resolve(fsPath);
  let best: { name: string; root: string } | null = null;
  for (const [name, configured] of roots) {
    const root = path.resolve(configured);
    if (!file.startsWith(root + path.sep)) continue;
    if (!best || root.length > best.root.length) best = { name, root };
  }
  if (!best) return null;
  const rel = file.slice(best.root.length + 1).split(path.sep).join('/');
  return `vault://${best.name}/${rel}`;
}

// - one spelling per file: absolute, no doubled or trailing slash, symlinks followed while the file exists
function samePathKey(p: string): string {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { return abs; }
}

/**
 * The node uris, each once and in the order given, that resolve to the changed file. `resolve`
 * turns a node uri into a file path, or null for one that names no file (an unknown vault, Notion).
 */
export function urisForChangedFile(uris: Iterable<string>, resolve: (uri: string) => string | null, changedPath: string): string[] {
  const changed = samePathKey(changedPath);
  const out: string[] = [];
  for (const uri of new Set(uris)) {
    const fsPath = resolve(uri);
    if (fsPath !== null && samePathKey(fsPath) === changed) out.push(uri);
  }
  return out;
}
