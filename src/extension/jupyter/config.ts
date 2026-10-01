export interface KernelServerConfig {
  name:   string;
  hubUrl: string;
  token:  string;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** One server named `default` from JUPYTER_SERVER_URL and JUPYTER_API_TOKEN, when both are set. */
export function defaultServerFromEnv(env: Record<string, string | undefined>): KernelServerConfig[] {
  const hubUrl = env.JUPYTER_SERVER_URL;
  const token  = env.JUPYTER_API_TOKEN;
  return hubUrl && token ? [{ name: 'default', hubUrl, token }] : [];
}

/** A settings file as the MCP server read it: its parsed content, or why there is none. */
export interface SettingsRead {
  file:     string;
  json?:    Record<string, unknown>;
  problem?: string;
}

/** The Jupyter servers the MCP server found, where they came from, and every place it looked first. */
export interface KernelLookup {
  servers: KernelServerConfig[];
  from:    string | null;
  looked:  string[];
}

/**
 * The MCP server's Jupyter servers, first non-empty source wins: the list the AI companion passes in
 * SKENA_JUPYTER_KERNELS, then `skena.jupyter.kernels` from each settings file in the order given
 * (settings.local.json before settings.json), then JUPYTER_SERVER_URL + JUPYTER_API_TOKEN.
 * `harness` null skips the first source for a caller that has none (the extension itself).
 * `looked` names each place tried and what was missing there; it never holds a token.
 */
export function pickKernelServers(
  harness:  string | null | undefined,
  settings: SettingsRead[],
  env:      Record<string, string | undefined>,
): KernelLookup {
  const looked: string[] = [];
  if (harness === undefined || harness === '') looked.push('SKENA_JUPYTER_KERNELS (not set)');
  else if (harness !== null) {
    let list: unknown;
    try { list = JSON.parse(harness); } catch { list = undefined; }
    // - the companion passes `[]` when the host has no servers: that must not hide the files below
    if (Array.isArray(list) && list.length) return { servers: list as KernelServerConfig[], from: 'SKENA_JUPYTER_KERNELS', looked };
    looked.push(Array.isArray(list) ? 'SKENA_JUPYTER_KERNELS (empty list)' : 'SKENA_JUPYTER_KERNELS (not a JSON list)');
  }

  for (const s of settings) {
    if (s.problem) { looked.push(`${s.file} (${s.problem})`); continue; }
    const list = s.json?.['skena.jupyter.kernels'];
    if (Array.isArray(list) && list.length) return { servers: list as KernelServerConfig[], from: s.file, looked };
    looked.push(`${s.file} (no skena.jupyter.kernels)`);
  }

  const fromEnv = defaultServerFromEnv(env);
  if (fromEnv.length) return { servers: fromEnv, from: 'JUPYTER_SERVER_URL + JUPYTER_API_TOKEN', looked };
  const unset = ['JUPYTER_SERVER_URL', 'JUPYTER_API_TOKEN'].filter(k => !env[k]);
  looked.push(`${unset.join(' and ')} (not set)`);
  return { servers: [], from: null, looked };
}

export const XLMCP_ENV_FILE = '~/.aix/xlmcp/.env';

/**
 * The extension's own Jupyter servers (kernel nodes, Run, the list the AI companion hands the MCP
 * server), first non-empty source wins: VS Code's `skena.jupyter.kernels` (workspace over user
 * settings), then the same key in .vscode/settings.local.json, which VS Code does not read, then
 * JUPYTER_SERVER_URL + JUPYTER_API_TOKEN, then those two keys in ~/.aix/xlmcp/.env.
 */
export function pickCanvasKernelServers(
  setting:   unknown,
  local:     SettingsRead,
  env:       Record<string, string | undefined>,
  xlmcpEnv:  string | null,
): KernelLookup {
  const fromVscode: SettingsRead = { file: 'VS Code settings', json: { 'skena.jupyter.kernels': setting } };
  const lookup = pickKernelServers(null, [fromVscode, local], env);
  if (lookup.servers.length) return lookup;
  const fromFile = xlmcpEnv === null ? [] : defaultServerFromEnv(parseEnvFile(xlmcpEnv));
  if (fromFile.length) return { servers: fromFile, from: XLMCP_ENV_FILE, looked: lookup.looked };
  const why = xlmcpEnv === null ? 'missing' : 'no JUPYTER_SERVER_URL + JUPYTER_API_TOKEN';
  return { ...lookup, looked: [...lookup.looked, `${XLMCP_ENV_FILE} (${why})`] };
}

/** The reply for a server name the lookup does not hold: the names it has and their source, or where it looked. */
export function unknownServerText(name: string, lookup: KernelLookup): string {
  if (lookup.servers.length) {
    return `error: unknown server ${name} — known: ${lookup.servers.map(s => s.name).join(', ')} (from ${lookup.from})`;
  }
  return `error: unknown server ${name} — no Jupyter servers configured; looked in: ${lookup.looked.join('; ')}`;
}
