/**
 * Vault indexer — scans vault directories for .md files, parses YAML frontmatter,
 * builds a fuse.js index for fuzzy search.
 *
 * Scanning strategy:
 *   • If a vault entry has a `directories` array, only those subdirs are scanned.
 *   • If `directories` is omitted or `['.']`, the entire vault root is scanned
 *     recursively (suitable for Obsidian vaults with arbitrary structure).
 *   • The global `skena.vaultDirectories` setting is the fallback when a vault
 *     has no per-vault `directories` list.
 *
 * Shared by all editor panels (one indexer per extension instance).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import matter from 'gray-matter';
import Fuse, { IFuseOptions } from 'fuse.js';
import { VaultConfig, VaultEntry } from '../shared/types';
import { getVaultDirectories } from './settings';

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

// - directories always excluded during recursive scan
const EXCLUDED_DIRS = new Set([
  '.obsidian', '.git', '.github', 'node_modules', '__pycache__',
  'dist', 'build', '.venv', 'venv', '.DS_Store',
]);

// - cap to avoid freezing on enormous vaults
const MAX_FILES = 10_000;

export class VaultIndexer implements vscode.Disposable {
  private entries: VaultEntry[] = [];
  private fuse    = new Fuse<VaultEntry>([], FUSE_OPTIONS);
  private indexing = false;
  private readonly out: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.out = vscode.window.createOutputChannel('Skena');
  }

  async reindex(vaults: VaultConfig[]): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;
    this.out.appendLine(`[reindex] starting — ${vaults.length} vault(s) configured`);
    vaults.forEach(v => this.out.appendLine(`  vault "${v.name}" → ${v.path}`));

    try {
      const all: VaultEntry[] = [];
      // - global fallback directories (default: ['.'] = full vault), local overrides win
      const globalDirs = await getVaultDirectories();

      for (const vault of vaults) {
        const root = this.expandPath(vault.path);
        // - per-vault dirs → global dirs → full vault
        const dirs = vault.directories?.length ? vault.directories : globalDirs;
        const scanFull = dirs.length === 0 || (dirs.length === 1 && dirs[0] === '.');

        this.out.appendLine(`  scanning "${vault.name}" at ${root} (dirs=${JSON.stringify(dirs)})`);

        if (scanFull) {
          const entries = await this.scanRecursive(vault.name, root, root, all.length);
          all.push(...entries);
        } else {
          for (const dir of dirs) {
            const dirPath = path.join(root, dir);
            const entries = await this.scanRecursive(vault.name, dirPath, root, all.length);
            all.push(...entries);
            if (all.length >= MAX_FILES) break;
          }
        }
        this.out.appendLine(`  "${vault.name}" — ${all.length} total entries so far`);
        if (all.length >= MAX_FILES) break;
      }

      this.entries = all;
      this.fuse = new Fuse(all, FUSE_OPTIONS);
      this.out.appendLine(`[reindex] done — ${all.length} entries indexed`);
    } catch (e) {
      this.out.appendLine(`[reindex] ERROR: ${e}`);
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
    this.out.dispose();
  }

  // ─── private ────────────────────────────────────────────────────────────────

  /**
   * Recursively scan `dirPath` for .md files, building vault:// URIs relative
   * to `vaultRoot`. Returns early once `alreadyFound` + results reach MAX_FILES.
   */
  private async scanRecursive(
    vaultName: string,
    dirPath:   string,
    vaultRoot: string,
    alreadyFound: number,
  ): Promise<VaultEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(dirPath);
    } catch {
      return []; // - dir doesn't exist or not readable, skip silently
    }

    const entries: VaultEntry[] = [];

    for (const name of names) {
      if (alreadyFound + entries.length >= MAX_FILES) break;

      // - skip hidden files/dirs and known system directories
      if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue;

      const fsPath = path.join(dirPath, name);
      let stat;
      try { stat = await fs.stat(fsPath); } catch { continue; }

      if (stat.isDirectory()) {
        const sub = await this.scanRecursive(vaultName, fsPath, vaultRoot, alreadyFound + entries.length);
        entries.push(...sub);
      } else if (name.endsWith('.md')) {
        const entry = await this.parseEntry(vaultName, fsPath, vaultRoot);
        if (entry) entries.push(entry);
      }
    }

    return entries;
  }

  private async parseEntry(
    vaultName: string,
    fsPath:    string,
    vaultRoot: string,
  ): Promise<VaultEntry | null> {
    try {
      const raw = await fs.readFile(fsPath, 'utf-8');
      const { data } = matter(raw);

      // - path relative to vault root, forward-slash separated
      const relPath = path.relative(vaultRoot, fsPath).replace(/\\/g, '/');

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
