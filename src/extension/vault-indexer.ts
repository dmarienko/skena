/**
 * Vault indexer — scans vault directories for .md files, parses YAML frontmatter,
 * builds a fuse.js index for fuzzy search.
 *
 * Shared by all editor panels (one indexer per extension instance).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import matter from 'gray-matter';
import Fuse, { IFuseOptions } from 'fuse.js';
import { VaultConfig, VaultEntry } from '../shared/types';

const FUSE_OPTIONS: IFuseOptions<VaultEntry> = {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'id',    weight: 0.3 },
    { name: 'tags',  weight: 0.15 },
    { name: 'type',  weight: 0.05 },
  ],
  threshold: 0.35,
  includeScore: true,
};

export class VaultIndexer implements vscode.Disposable {
  private entries: VaultEntry[] = [];
  private fuse = new Fuse<VaultEntry>([], FUSE_OPTIONS);
  private indexing = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async reindex(vaults: VaultConfig[]): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;
    try {
      const all: VaultEntry[] = [];
      for (const vault of vaults) {
        const expanded = this.expandPath(vault.path);
        const config = vscode.workspace.getConfiguration('skena');
        const dirs = config.get<string[]>('vaultDirectories') ?? ['alpha', 'knowledge', 'logs', 'inbox'];
        for (const dir of dirs) {
          const dirPath = path.join(expanded, dir);
          const entries = await this.scanDir(vault.name, dirPath);
          all.push(...entries);
        }
      }
      this.entries = all;
      this.fuse = new Fuse(all, FUSE_OPTIONS);
      console.log(`Skena: indexed ${all.length} vault entries`);
    } finally {
      this.indexing = false;
    }
  }

  search(query: string, limit = 20): VaultEntry[] {
    if (!query.trim()) return this.entries.slice(0, limit);
    return this.fuse.search(query, { limit }).map(r => r.item);
  }

  all(): VaultEntry[] {
    return this.entries;
  }

  /** - show a VS Code QuickPick for vault search, return selected entry */
  async quickPick(): Promise<VaultEntry | undefined> {
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { entry: VaultEntry }>();
    pick.placeholder = 'Search vault (title, id, tags)...';
    pick.items = this.entries.slice(0, 30).map(e => this.toQuickPickItem(e));

    pick.onDidChangeValue(q => {
      pick.items = this.search(q, 30).map(e => this.toQuickPickItem(e));
    });

    return new Promise(resolve => {
      pick.onDidAccept(() => {
        const selected = pick.activeItems[0] as (vscode.QuickPickItem & { entry: VaultEntry }) | undefined;
        pick.dispose();
        resolve(selected?.entry);
      });
      pick.onDidHide(() => {
        pick.dispose();
        resolve(undefined);
      });
      pick.show();
    });
  }

  dispose(): void {
    // - nothing to dispose currently; chokidar watcher is in FileWatcher
  }

  // ─── private ────────────────────────────────────────────────────────────────

  private async scanDir(vaultName: string, dirPath: string): Promise<VaultEntry[]> {
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      return [];  // - dir doesn't exist, skip silently
    }

    const entries: VaultEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const fsPath = path.join(dirPath, file);
      const entry = await this.parseEntry(vaultName, fsPath);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  private async parseEntry(vaultName: string, fsPath: string): Promise<VaultEntry | null> {
    try {
      const raw = await fs.readFile(fsPath, 'utf-8');
      const { data } = matter(raw);

      // - compute vault-relative path for URI
      const config = vscode.workspace.getConfiguration('skena');
      const vaults = config.get<Array<{ name: string; path: string }>>('skena.vaults') ?? [];
      const vaultConfig = vaults.find(v => v.name === vaultName);
      const vaultRoot = vaultConfig ? this.expandPath(vaultConfig.path) : '';
      const relPath = vaultRoot
        ? fsPath.slice(vaultRoot.length).replace(/^\//, '')
        : fsPath;

      return {
        id:     String(data['id'] ?? path.basename(fsPath, '.md')),
        title:  String(data['title'] ?? path.basename(fsPath, '.md')),
        type:   data['type'],
        status: data['status'],
        score:  data['score'] ?? undefined,
        tags:   Array.isArray(data['tags']) ? data['tags'] : [],
        uri:    `vault://${vaultName}/${relPath}`,
        fsPath,
      };
    } catch (e) {
      console.warn(`Skena: failed to parse ${fsPath}:`, e);
      return null;
    }
  }

  private toQuickPickItem(entry: VaultEntry): vscode.QuickPickItem & { entry: VaultEntry } {
    const statusIcon = entry.status ? `$(circle-filled) ` : '';
    const tags = entry.tags.length ? entry.tags.slice(0, 3).join(', ') : '';
    return {
      label:       `${statusIcon}${entry.title}`,
      description: entry.type ?? '',
      detail:      tags,
      entry,
    };
  }

  private expandPath(p: string): string {
    return p.startsWith('~') ? path.join(process.env.HOME ?? '~', p.slice(1)) : p;
  }
}
