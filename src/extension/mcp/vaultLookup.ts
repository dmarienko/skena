/**
 * The vault list the MCP server resolves vault:// file nodes with, the one the extension renders
 * them with as near as a process outside VS Code can tell: the running extension's own list over
 * its relay (POST /vaults), else skena.vaults in the .vscode settings files nearest above the
 * canvas, else in the settings of the nearest .code-workspace file whose folders hold the canvas.
 * The first place that has a list decides, an empty one included. No vscode import.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { VaultConfig } from '../../shared/types';
import { parseSettingsJson } from '../settingsJson';
import { vaultRoot } from '../filePaths';

/** - one place looked at: what it is, its list (null when it has none) and a note for the reader */
export interface VaultSource { where: string; vaults: VaultConfig[] | null; note: string }
/** - the list chosen (empty when no place had one) and the places looked at, in order */
export interface VaultLookup { vaults: VaultConfig[]; looked: VaultSource[] }
export type RelayVaults = { kind: 'answer'; vaults: VaultConfig[] } | { kind: 'none'; why: string };

// - every tool call that reads a vault file asks the relay, so the wait is short and the answer kept a while
export const RELAY_WAIT_MS = 500;
export const RELAY_CACHE_MS = 3000;

const EXTENSION = 'the skena extension';
const SETTINGS_LEVELS = 8;

/** - entries with a string name and path, the path expanded from ~ and resolved (filePaths.vaultRoot) */
export function normaliseVaults(list: unknown[], home: string | undefined): VaultConfig[] {
  const out: VaultConfig[] = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const { name, path: p } = v as { name?: unknown; path?: unknown };
    if (typeof name !== 'string' || typeof p !== 'string') continue;
    out.push({ ...(v as VaultConfig), path: vaultRoot(p, home) });
  }
  return out;
}

const listNote = (vaults: VaultConfig[]) =>
  vaults.length ? `${vaults.length} vault(s): ${vaults.map(v => v.name).join(', ')}` : 'an empty skena.vaults';

/** The relay's vault list (POST /vaults), or why there is none: nothing listening, refused, no answer within `timeoutMs`. */
export function requestRelayVaults(port: number, token: string, timeoutMs: number, home: string | undefined): Promise<RelayVaults> {
  return new Promise(resolve => {
    let settled = false;
    const done = (r: RelayVaults) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const data = '{}';
    const req = http.request({
      host: '127.0.0.1', port, path: '/vaults', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-skena-token': token },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { text += c; });
      res.on('error', e => done({ kind: 'none', why: e.message }));
      res.on('end', () => {
        // - an extension older than this script has no /vaults and refuses it like a wrong token
        if (res.statusCode !== 200) return done({ kind: 'none', why: `refused (HTTP ${res.statusCode})` });
        try {
          const j = JSON.parse(text) as { vaults?: unknown };
          if (!Array.isArray(j.vaults)) return done({ kind: 'none', why: 'no vault list in its answer' });
          done({ kind: 'answer', vaults: normaliseVaults(j.vaults, home) });
        } catch {
          done({ kind: 'none', why: 'an answer that is not JSON' });
        }
      });
    });
    const timer = setTimeout(() => { done({ kind: 'none', why: `no answer within ${timeoutMs} ms` }); req.destroy(); }, timeoutMs);
    req.on('error', (e: NodeJS.ErrnoException) => done({ kind: 'none', why: e.code === 'ECONNREFUSED' ? 'nothing listening at its port' : e.message }));
    req.end(data);
  });
}

/** Reads the places in order and stops at the first that has a list. */
export async function chooseVaults(steps: (() => VaultSource | Promise<VaultSource>)[]): Promise<VaultLookup> {
  const looked: VaultSource[] = [];
  for (const step of steps) {
    const s = await step();
    looked.push(s);
    if (s.vaults) return { vaults: s.vaults, looked };
  }
  return { vaults: [], looked };
}

/**
 * A .code-workspace file (JSON with comments and trailing commas): its folders as absolute paths,
 * relative ones from the file's own folder, and its settings' skena.vaults, null when it sets none.
 * Throws when the text does not parse.
 */
export function parseWorkspaceFile(raw: string, file: string, home: string | undefined): { folders: string[]; vaults: VaultConfig[] | null } {
  const json = parseSettingsJson(raw);
  const folders: string[] = [];
  for (const f of Array.isArray(json.folders) ? json.folders : []) {
    const { path: p, uri } = (f ?? {}) as { path?: unknown; uri?: unknown };
    if (typeof p === 'string') folders.push(path.resolve(path.dirname(file), p));
    else if (typeof uri === 'string' && uri.startsWith('file:')) folders.push(fileURLToPath(uri));
  }
  const settings = json.settings && typeof json.settings === 'object' ? json.settings as Record<string, unknown> : {};
  const list = settings['skena.vaults'];
  return { folders, vaults: Array.isArray(list) ? normaliseVaults(list, home) : null };
}

// - a path as given and with links followed, so a folder spelled either way matches
function spellings(p: string): string[] {
  const abs = path.resolve(p);
  try { const real = fs.realpathSync(abs); return real === abs ? [abs] : [abs, real]; } catch { return [abs]; }
}

const inside = (file: string, folder: string) => file === folder || file.startsWith(folder + path.sep);

// - the canvas's spellings, its folder's when the canvas file itself is not there
function canvasSpellings(canvasPath: string): string[] {
  const abs = path.resolve(canvasPath);
  const real = spellings(path.dirname(abs)).map(d => path.join(d, path.basename(abs)));
  return [...new Set([abs, ...real])];
}

function workspaceFilesIn(dir: string): string[] {
  try { return fs.readdirSync(dir).filter(n => n.endsWith('.code-workspace')).sort().map(n => path.join(dir, n)); } catch { return []; }
}

/**
 * The nearest .code-workspace file whose folders hold the canvas: each start's folder and its
 * parents are searched in turn, the first start's first. Null when none does.
 */
export function findWorkspaceFile(canvasPath: string, starts: string[]): string | null {
  const canvas = canvasSpellings(canvasPath);
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      if (!seen.has(dir)) {
        seen.add(dir);
        for (const file of workspaceFilesIn(dir)) {
          let folders: string[];
          try { folders = parseWorkspaceFile(fs.readFileSync(file, 'utf-8'), file, undefined).folders; } catch { continue; }
          if (folders.some(f => spellings(f).some(sp => canvas.some(c => inside(c, sp))))) return file;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function readJson(file: string): Record<string, unknown> | null {
  try { return parseSettingsJson(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

/**
 * skena.vaults in the nearest .vscode/settings.json at or above `startDir` (up to 8 folders), the
 * one in settings.local.json beside it replacing it whole.
 */
export function settingsFileSource(startDir: string, home: string | undefined): VaultSource {
  let dir = path.resolve(startDir);
  for (let i = 0; i < SETTINGS_LEVELS; i++) {
    const basePath = path.join(dir, '.vscode', 'settings.json');
    const base = readJson(basePath);
    if (base !== null) {
      const localPath = path.join(dir, '.vscode', 'settings.local.json');
      const local = readJson(localPath);
      const fromLocal = Array.isArray(local?.['skena.vaults']);
      const list = fromLocal ? local!['skena.vaults'] : base['skena.vaults'];
      const vaults = Array.isArray(list) ? normaliseVaults(list, home) : null;
      return { where: fromLocal ? localPath : basePath, vaults, note: vaults ? listNote(vaults) : 'no skena.vaults' };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { where: '.vscode/settings.json', vaults: null, note: `none in ${path.resolve(startDir)} or the folders above it` };
}

function workspaceFileSource(canvasPath: string, cwd: string, home: string | undefined): VaultSource {
  const file = findWorkspaceFile(canvasPath, [path.dirname(path.resolve(canvasPath)), cwd]);
  if (!file) return { where: '.code-workspace', vaults: null, note: `no .code-workspace file above the canvas or ${cwd} lists a folder holding the canvas` };
  try {
    const { vaults } = parseWorkspaceFile(fs.readFileSync(file, 'utf-8'), file, home);
    return { where: file, vaults, note: vaults ? listNote(vaults) : 'no skena.vaults in its settings' };
  } catch (e) {
    return { where: file, vaults: null, note: `not readable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// - "port:token" → when it was asked and what it said
const relayCache = new Map<string, { at: number; result: RelayVaults }>();

async function relaySource(relay: LoadOptions['relay'], now: number, waitMs: number, home: string | undefined): Promise<VaultSource> {
  if (!relay) return { where: EXTENSION, vaults: null, note: 'no window for this workspace (no SKENA_RUN_IPC, no endpoint file)' };
  const key = `${relay.port}:${relay.token}`;
  let hit = relayCache.get(key);
  if (!hit || now - hit.at > RELAY_CACHE_MS || now < hit.at) {
    hit = { at: now, result: await requestRelayVaults(relay.port, relay.token, waitMs, home) };
    relayCache.set(key, hit);
  }
  const where = `${EXTENSION} (relay at 127.0.0.1:${relay.port})`;
  return hit.result.kind === 'answer'
    ? { where, vaults: hit.result.vaults, note: listNote(hit.result.vaults) }
    : { where, vaults: null, note: hit.result.why };
}

export interface LoadOptions {
  /** - the relay of the extension window for this workspace, null when none is known */
  relay: { port: number; token: string } | null;
  /** - this process's working folder: its parents are searched for a .code-workspace file too */
  cwd: string;
  home: string | undefined;
  now?: number;
  waitMs?: number;
}

/** The vault list for vault:// nodes of `canvasPath`, with every place looked at. */
export async function loadVaults(canvasPath: string, opts: LoadOptions): Promise<VaultLookup> {
  const now = opts.now ?? Date.now();
  return chooseVaults([
    () => relaySource(opts.relay, now, opts.waitMs ?? RELAY_WAIT_MS, opts.home),
    () => settingsFileSource(path.dirname(path.resolve(canvasPath)), opts.home),
    () => workspaceFileSource(canvasPath, opts.cwd, opts.home),
  ]);
}

/** - why a vault:// node names no file: the vault, then each place looked at and what it held */
export function notConfiguredText(name: string, lookup: VaultLookup): string {
  return [
    `vault "${name}" not configured. Looked at:`,
    ...lookup.looked.map(s => `  ${s.where}: ${s.note}`),
    'Add it to skena.vaults in .vscode/settings.json, or in the settings of the .code-workspace file.',
  ].join('\n');
}
