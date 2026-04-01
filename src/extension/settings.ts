/**
 * Skena settings helpers.
 *
 * Reading strategy (in priority order):
 *   1. `.vscode/settings.local.json` in the workspace folder — personal overrides,
 *      not committed to git (vault paths, personal preferences).
 *   2. `.vscode/settings.json` in the workspace folder — committed project config.
 *   3. VS Code's getConfiguration() API — user-level settings, machine defaults.
 *
 * We read the JSON files directly rather than relying solely on
 * vscode.workspace.getConfiguration because extensionKind:"workspace" combined
 * with certain VS Code trust / scope restrictions can cause workspace-level
 * values to be silently ignored by the configuration API.
 *
 * Merge rules:
 *   • If a key is present in settings.local.json it completely replaces the
 *     value from settings.json (arrays are replaced, not merged).
 *   • Keys absent from the local file fall through to settings.json, then
 *     to VS Code's configuration API.
 */

import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import { VaultConfig } from '../shared/types';

// ─── file reader ──────────────────────────────────────────────────────────────

/**
 * Parse VS Code's relaxed JSON (allows comments and trailing commas).
 * Strips // and block comments, then removes trailing commas before ] or }.
 */
function parseRelaxedJson(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/\/\/[^\n]*/g, '')               // - line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')         // - block comments
    .replace(/,(\s*[}\]])/g, '$1');           // - trailing commas
  return JSON.parse(stripped) as Record<string, unknown>;
}

/** Read a settings JSON file; returns null if missing or unparseable. */
async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseRelaxedJson(raw);
  } catch {
    return null;
  }
}

/**
 * Read workspace settings from disk, merging local overrides on top.
 * Returns [localSettings, baseSettings] — either may be null if missing.
 */
async function readWorkspaceSettings(): Promise<[
  local: Record<string, unknown> | null,
  base:  Record<string, unknown> | null,
]> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) return [null, null];

  const vscodeDir = path.join(wsFolder, '.vscode');
  const [local, base] = await Promise.all([
    readJson(path.join(vscodeDir, 'settings.local.json')),
    readJson(path.join(vscodeDir, 'settings.json')),
  ]);
  return [local, base];
}

// ─── typed accessors ──────────────────────────────────────────────────────────

/**
 * Return the effective `skena.vaults` list.
 * Priority: settings.local.json → settings.json → VS Code user config.
 */
export async function getVaults(): Promise<VaultConfig[]> {
  const [local, base] = await readWorkspaceSettings();

  if (Array.isArray(local?.['skena.vaults'])) {
    return local!['skena.vaults'] as VaultConfig[];
  }
  if (Array.isArray(base?.['skena.vaults'])) {
    return base!['skena.vaults'] as VaultConfig[];
  }

  // - fall back to VS Code user-level config (e.g. set in ~/.config/Code/User/settings.json)
  return vscode.workspace.getConfiguration('skena').get<VaultConfig[]>('vaults') ?? [];
}

/**
 * Return the effective `skena.vaultDirectories` list.
 * Priority: settings.local.json → settings.json → VS Code user config.
 */
export async function getVaultDirectories(): Promise<string[]> {
  const [local, base] = await readWorkspaceSettings();

  if (Array.isArray(local?.['skena.vaultDirectories'])) {
    return local!['skena.vaultDirectories'] as string[];
  }
  if (Array.isArray(base?.['skena.vaultDirectories'])) {
    return base!['skena.vaultDirectories'] as string[];
  }

  return vscode.workspace.getConfiguration('skena').get<string[]>('vaultDirectories') ?? ['.'];
}
