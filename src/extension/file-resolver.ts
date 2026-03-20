/**
 * Resolves Skena URIs to absolute filesystem paths.
 *
 * URI formats:
 *   vault://v1/alpha/storm.md        → <vaults['v1'].path>/alpha/storm.md
 *   vault://notion/abc123            → Notion MCP fetch (not a fs path)
 *   ../models/storm/m0.py            → relative to .canvas file location
 *   /absolute/path/file.py           → used as-is
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { VaultConfig, VaultUri, FileType } from '../shared/types';
import { VAULT_SCHEME, NOTION_VAULT_NAME } from '../shared/constants';

export interface ResolvedFile {
  fsPath: string;
  fileType: FileType;
  isNotion: false;
}

export interface ResolvedNotion {
  pageId: string;
  isNotion: true;
}

export type ResolvedUri = ResolvedFile | ResolvedNotion;

/** - map file extensions to FileType */
function extensionToFileType(ext: string): FileType {
  switch (ext.toLowerCase()) {
    case '.md':    return 'markdown';
    case '.ipynb': return 'notebook';
    case '.py':    return 'python';
    case '.yaml':
    case '.yml':   return 'yaml';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.svg':
    case '.gif':   return 'image';
    default:       return 'unknown';
  }
}

/** - parse vault://name/path into { vault, path } */
function parseVaultUri(uri: string): VaultUri | null {
  if (!uri.startsWith(VAULT_SCHEME)) return null;
  const rest = uri.slice(VAULT_SCHEME.length);  // - "v1/alpha/storm.md"
  const slash = rest.indexOf('/');
  if (slash === -1) return { vault: rest, path: '' };
  return {
    vault: rest.slice(0, slash),
    path:  rest.slice(slash + 1),
  };
}

export class FileResolver {
  private vaults: Map<string, string> = new Map();

  constructor(vaultConfigs: VaultConfig[]) {
    this.updateVaults(vaultConfigs);
  }

  updateVaults(vaultConfigs: VaultConfig[]): void {
    this.vaults.clear();
    for (const v of vaultConfigs) {
      // - expand ~ to home dir
      const expanded = v.path.startsWith('~')
        ? path.join(process.env.HOME ?? '~', v.path.slice(1))
        : v.path;
      this.vaults.set(v.name, expanded);
    }
  }

  /**
   * Resolve a URI to a filesystem path (or Notion page id).
   * @param uri      - vault:// URI or project-relative path
   * @param canvasDir - directory of the .canvas file (for relative paths)
   */
  resolve(uri: string, canvasDir: string): ResolvedUri | null {
    // - vault:// URI
    if (uri.startsWith(VAULT_SCHEME)) {
      const parsed = parseVaultUri(uri);
      if (!parsed) return null;

      // - notion vault
      if (parsed.vault === NOTION_VAULT_NAME) {
        return { pageId: parsed.path, isNotion: true };
      }

      // - named vault
      const vaultRoot = this.vaults.get(parsed.vault);
      if (!vaultRoot) {
        console.warn(`Skena: unknown vault "${parsed.vault}" in URI: ${uri}`);
        return null;
      }
      const fsPath = path.join(vaultRoot, parsed.path);
      return { fsPath, fileType: extensionToFileType(path.extname(fsPath)), isNotion: false };
    }

    // - absolute path
    if (path.isAbsolute(uri)) {
      return { fsPath: uri, fileType: extensionToFileType(path.extname(uri)), isNotion: false };
    }

    // - relative path (relative to .canvas directory)
    const fsPath = path.resolve(canvasDir, uri);
    return { fsPath, fileType: extensionToFileType(path.extname(fsPath)), isNotion: false };
  }

  /**
   * Convert a filesystem path to a webview-safe vscode-resource:// URI.
   * Raw file:// paths are blocked by the webview sandbox.
   */
  toWebviewUri(fsPath: string, webview: vscode.Webview): string {
    return webview.asWebviewUri(vscode.Uri.file(fsPath)).toString();
  }

  /**
   * Reverse lookup — given an absolute fs path, return a vault:// URI if the
   * file belongs to a configured vault, otherwise return null (caller falls
   * back to a relative project path).
   */
  resolveFromFsPath(fsPath: string): string | null {
    for (const [name, root] of this.vaults) {
      if (fsPath.startsWith(root + path.sep) || fsPath.startsWith(root + '/')) {
        const rel = fsPath.slice(root.length).replace(/^[/\\]/, '');
        return `vault://${name}/${rel}`;
      }
    }
    return null;
  }

  /**
   * Check if a file exists on disk.
   */
  exists(fsPath: string): boolean {
    return fs.existsSync(fsPath);
  }
}
