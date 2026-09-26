import { KnowledgeGoneError, type AssetFetch, type KnowledgeHit, type KnowledgeProvider, type KnowledgeQuery, type KnowledgeServerConfig, type KnowledgeText, type KnowledgeWrite, type ToolTransport } from '../../../shared/knowledge/types';
import { buildCrtxUri, crtxAssetUrl, crtxReaderUrl, parseCrtxUri } from '../../../shared/knowledge/crtxUri';

interface CrtxHit { vault: string; file: string; heading: string; date?: string; tags?: string[]; snippet?: string; uri?: string; text?: string }

// - the server wraps some results as {result: …}; others come bare
function unwrap<T>(x: unknown): T {
  const o = x as { result?: T };
  return (o && typeof o === 'object' && 'result' in o ? o.result : x) as T;
}

// - a search row: the heading, or the file's name for a whole-file hit; the path is on the row's
//   second line, so sections of one long file differ in the part that is not cut off
const hitTitleOf = (r: { file: string; heading: string }) => r.heading || r.file.slice(r.file.lastIndexOf('/') + 1);

// - a node header has one line: the heading first, so a narrow node still shows it, then the file.
//   Brackets, not a dash: crtx headings often hold " — " themselves ("2026-09-19 — state")
const titleOf = (r: { file: string; heading: string }) => r.heading ? `${r.heading} (${r.file})` : r.file;

// - the transport parses a reply that is JSON, so a section whose whole text is JSON arrives as an
//   object or an array; String() on one of those reads "[object Object]", so show it as JSON
function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

// - the server's own wording for a target that is not there, from crtx-server's mcp_server.py:
//   "no section 'h' in f; available: [...]", "file not found: 'f'", "unknown vault: 'v'".
//   "Unknown tool: read_section" is a server too old for the tool, or a wrong kind — not gone.
const GONE = /no section .+ in |file not found|unknown vault/i;

// - the directory a note lives in, "" for a note at the vault root
const dirOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

// - an absolute reference of any scheme (http:, https:, data:) is left as it is
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// - a markdown image: ![alt](path), with an optional "title" after the path. A path in <angle
//   brackets> may hold spaces; a bare path may not
const IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^<>\n]*)>|([^)\s]*))((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g;

// - a path is percent-encoded when it names a file with a space or another character markdown's
//   bare (non-<…>) form cannot carry; decode before resolving, so "a%20b.svg" and "<a b.svg>"
//   land on the same vault file. Not everything after a stray "%" is a valid escape — keep the
//   path as written rather than throw one away
function decodePath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}

// - a fenced block opens and closes with three or more backticks or tildes
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * The path a reference points at, from the vault root, or null when it walks out of the vault.
 * A leading "/" is read as the vault root, which is what the server's own reader does.
 */
export function resolveInVault(dir: string, path: string): string | null {
  const parts = path.startsWith('/') || !dir ? [] : dir.split('/');
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

const isVaultAsset = (file: string) => file.startsWith('assets/') && !file.split('/').includes('..');

// - `fn` runs on the text of the line, never on what is inside a `code span`
function outsideCodeSpans(line: string, fn: (text: string) => string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf('`', i);
    if (tick < 0) return out + fn(line.slice(i));
    out += fn(line.slice(i, tick));
    let run = 0;
    while (line[tick + run] === '`') run++;
    const close = line.indexOf('`'.repeat(run), tick + run);
    // - backticks that never close are text, not the start of a span
    if (close < 0) return out + line.slice(tick);
    out += line.slice(tick, close + run);
    i = close + run;
  }
  return out;
}

/**
 * Point every image in a note at the vault's own copy. A relative path that lands under the
 * vault's assets/ becomes a crtx uri, which the node can then ask the host for. A path that lands
 * anywhere else is not an image this server serves: the leading "!" is escaped so the line reads
 * as the text it is instead of as a broken image. Code spans and fenced blocks are left alone —
 * a note that writes `![](rel)` to talk about the syntax keeps its sample.
 */
export function rewriteImageRefs(text: string, ref: { vault: string; file: string }): string {
  const dir = dirOf(ref.file);
  const rewriteProse = (prose: string) => prose.replace(
    IMAGE,
    (whole, alt: string, anglePath: string | undefined, barePath: string | undefined, title: string, offset: number, all: string) => {
      if (all[offset - 1] === '\\') return whole;
      const path = decodePath(anglePath ?? barePath ?? '');
      if (HAS_SCHEME.test(path)) return whole;
      const resolved = resolveInVault(dir, path);
      if (resolved === null || !isVaultAsset(resolved)) return `\\${whole}`;
      return `![${alt}](${buildCrtxUri({ vault: ref.vault, file: resolved, heading: '' })}${title})`;
    },
  );

  let fence = '';
  return text.split('\n').map(line => {
    const m = FENCE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = '';
      return line;
    }
    if (m) { fence = m[1]; return line; }
    return outsideCodeSpans(line, rewriteProse);
  }).join('\n');
}

export function createCrtxProvider(config: KnowledgeServerConfig, transport: ToolTransport, assetFetch?: AssetFetch): KnowledgeProvider {
  return {
    name: config.name,
    kind: 'crtx',
    capabilities: { scopes: true, tags: true, recency: true, facets: true, write: true, assets: true },

    async search(q: KnowledgeQuery): Promise<KnowledgeHit[]> {
      const args: Record<string, unknown> = { query: q.text, top: q.top, full_text: false };
      if (q.scope && q.scope !== 'all') args.vault = q.scope;
      if (q.tags?.length) args.tags = q.tags;
      if (q.recency) args.recency = true;
      const hits = unwrap<CrtxHit[]>(await transport.callTool('search', args)) ?? [];
      return hits.map(h => ({
        server: config.name,
        uri: h.uri ?? buildCrtxUri({ vault: h.vault, file: h.file, heading: h.heading ?? '' }),
        title: hitTitleOf({ file: h.file, heading: h.heading ?? '' }),
        subtitle: `${h.vault} · ${h.file}`,
        date: h.date,
        tags: h.tags ?? [],
        snippet: h.snippet ?? (h.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
      }));
    },

    async fetch(uri: string, signal?: AbortSignal): Promise<KnowledgeText> {
      const r = parseCrtxUri(uri);
      let text: unknown;
      try {
        text = r.heading
          ? await transport.callTool('read_section', { vault: r.vault, file: r.file, heading: r.heading }, signal)
          : await transport.callTool('read', { vault: r.vault, file: r.file }, signal);
      } catch (e) {
        if (GONE.test((e as Error).message)) {
          throw new KnowledgeGoneError((e as Error).message);
        }
        throw e;
      }
      // - the cached copy carries the image uris, so a node renders the same text on any machine
      return { uri, title: titleOf(r), text: rewriteImageRefs(asText(unwrap(text)), r), fetchedAt: new Date().toISOString() };
    },

    async scopes(): Promise<string[]> {
      return (unwrap<{ name: string }[]>(await transport.callTool('list_vaults', {})) ?? []).map(v => v.name);
    },

    async facets(scope?: string) {
      const args: Record<string, unknown> = {}; if (scope && scope !== 'all') args.vault = scope;
      const f = unwrap<{ tags?: [string, number][] }>(await transport.callTool('facets', args));
      return { tags: f?.tags ?? [] };
    },

    openUrl(uri: string) { return crtxReaderUrl(uri, config.url); },

    // - the images rewriteImageRefs pointed at; the web app serves them from the vault's assets/
    //   on port 8787, behind the same bearer token as the MCP endpoint
    async asset(uri: string, signal?: AbortSignal) {
      const r = parseCrtxUri(uri);
      if (!isVaultAsset(r.file)) throw new Error(`not an asset of this server: ${uri}`);
      if (!assetFetch) throw new Error(`server "${config.name}" cannot read assets`);
      return assetFetch(crtxAssetUrl(uri, config.url), signal);
    },

    // - argument names read off the live tools/list on 2026-09-19 (crtx 1.28.1):
    //   create_note(vault, title, content, tags?, dest?, sections?, links?, session_id?, agent?) —
    //   the crtx vault requires non-empty slug tags from its controlled vocabulary;
    //   append_note(vault, file, content, session_id?, agent?).
    //   create_note replies {ok, file, vault}.
    async write(item: KnowledgeWrite) {
      const res = unwrap<{ uri?: string; file?: string; path?: string; vault?: string }>(await transport.callTool('create_note', {
        vault: item.scope ?? 'crtx', title: item.title, content: item.text, agent: 'skena',
        ...(item.tags?.length ? { tags: item.tags } : {}),
        ...(item.dest ? { dest: item.dest } : {}),
      }));
      const file = res?.file ?? res?.path ?? '';
      return { uri: res?.uri ?? buildCrtxUri({ vault: res?.vault ?? item.scope ?? 'crtx', file, heading: '' }) };
    },
    async append(uri: string, item: KnowledgeWrite) {
      const r = parseCrtxUri(uri);
      await transport.callTool('append_note', { vault: r.vault, file: r.file, content: item.text, agent: 'skena' });
    },
  };
}
