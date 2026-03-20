/**
 * File watcher — uses chokidar to watch vault directories and workspace files.
 * Notifies registered callbacks on change so canvas panels can re-render affected nodes.
 */

import * as chokidar from 'chokidar';
import * as path from 'path';
import { VaultConfig } from '../shared/types';
import { VaultIndexer } from './vault-indexer';

type ChangeCallback = (fsPath: string) => void;

export class FileWatcher {
  private watcher: chokidar.FSWatcher | undefined;
  private callbacks: Set<ChangeCallback> = new Set();

  constructor(private readonly indexer: VaultIndexer) {}

  startWatching(vaults: VaultConfig[]): void {
    this.watcher?.close();
    if (vaults.length === 0) return;

    const paths = vaults.map(v =>
      v.path.startsWith('~') ? path.join(process.env.HOME ?? '~', v.path.slice(1)) : v.path
    );

    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      ignored: /(^|[/\\])\..|(node_modules|__pycache__|dist)/,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher
      .on('change', (fsPath: string) => {
        // - re-index vault if a .md file changed
        if (fsPath.endsWith('.md')) {
          this.indexer.reindex(vaults);
        }
        this.notify(fsPath);
      })
      .on('add', (fsPath: string) => {
        if (fsPath.endsWith('.md')) {
          this.indexer.reindex(vaults);
        }
        this.notify(fsPath);
      })
      .on('unlink', (fsPath: string) => {
        if (fsPath.endsWith('.md')) {
          this.indexer.reindex(vaults);
        }
      });
  }

  /** - register a callback to be called when a watched file changes */
  onFileChanged(cb: ChangeCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  dispose(): void {
    this.watcher?.close();
    this.callbacks.clear();
  }

  private notify(fsPath: string): void {
    for (const cb of this.callbacks) {
      cb(fsPath);
    }
  }
}
