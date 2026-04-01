/**
 * Skena settings helpers.
 *
 * VS Code's getConfiguration() reads settings.json (workspace + user).
 * We additionally support `.vscode/settings.local.json` as a local override
 * layer — useful for personal vault paths that shouldn't be committed to git.
 *
 * Merge rules:
 *   • If a key is present in settings.local.json it completely replaces the
 *     value from settings.json (arrays are replaced, not merged).
 *   • Keys absent from the local file fall through to the VS Code value.
 */

import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import { VaultConfig } from '../shared/types';

// ─── local override reader ────────────────────────────────────────────────────

/** Strip JS-style comments so JSON.parse doesn't choke on them. */
function stripComments(raw: string): string {
  return raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Read `.vscode/settings.local.json` from the first workspace folder.
 * Returns a flat object of overrides (keys like `"skena.vaults"`), or {}
 * if the file doesn't exist or can't be parsed.
 */
async function readLocalOverrides(): Promise<Record<string, unknown>> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) return {};

  const localPath = path.join(wsFolder, '.vscode', 'settings.local.json');
  try {
    const raw  = await fs.readFile(localPath, 'utf-8');
    return JSON.parse(stripComments(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─── typed accessors ──────────────────────────────────────────────────────────

/**
 * Return the effective `skena.vaults` list.
 * Local override wins if `skena.vaults` is present in settings.local.json.
 */
export async function getVaults(): Promise<VaultConfig[]> {
  const local = await readLocalOverrides();
  if (Array.isArray(local['skena.vaults'])) {
    return local['skena.vaults'] as VaultConfig[];
  }
  const config = vscode.workspace.getConfiguration('skena');
  return config.get<VaultConfig[]>('vaults') ?? [];
}

/**
 * Return the effective `skena.vaultDirectories` list.
 * Local override wins if present in settings.local.json.
 */
export async function getVaultDirectories(): Promise<string[]> {
  const local = await readLocalOverrides();
  if (Array.isArray(local['skena.vaultDirectories'])) {
    return local['skena.vaultDirectories'] as string[];
  }
  const config = vscode.workspace.getConfiguration('skena');
  return config.get<string[]>('vaultDirectories') ?? ['.'];
}
