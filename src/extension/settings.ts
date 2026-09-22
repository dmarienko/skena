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
import type { KnowledgeServerConfig } from '../shared/knowledge/types';
import { parseSettingsJson } from './settingsJson';

// ─── file reader ──────────────────────────────────────────────────────────────

/** Read a settings JSON file; returns null if missing or unparseable. */
async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseSettingsJson(raw);
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

/**
 * Return the effective `skena.knowledge.servers` list.
 * Priority: settings.local.json → settings.json → VS Code user config.
 */
export async function getKnowledgeServers(): Promise<KnowledgeServerConfig[]> {
  const [local, base] = await readWorkspaceSettings();

  if (Array.isArray(local?.['skena.knowledge.servers'])) {
    return local!['skena.knowledge.servers'] as KnowledgeServerConfig[];
  }
  if (Array.isArray(base?.['skena.knowledge.servers'])) {
    return base!['skena.knowledge.servers'] as KnowledgeServerConfig[];
  }

  return vscode.workspace.getConfiguration('skena').get<KnowledgeServerConfig[]>('knowledge.servers') ?? [];
}

/**
 * Return the effective `skena.knowledge.refreshAfterHours`.
 * Priority: settings.local.json → settings.json → VS Code user config; 24 if unset or not a number.
 */
export async function getKnowledgeRefreshAfterHours(): Promise<number> {
  const [local, base] = await readWorkspaceSettings();

  const v = local?.['skena.knowledge.refreshAfterHours']
    ?? base?.['skena.knowledge.refreshAfterHours']
    ?? vscode.workspace.getConfiguration('skena').get<number>('knowledge.refreshAfterHours');

  return typeof v === 'number' && v >= 0 ? v : 24;
}
