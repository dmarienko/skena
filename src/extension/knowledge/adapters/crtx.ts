import { KnowledgeGoneError, type KnowledgeHit, type KnowledgeProvider, type KnowledgeQuery, type KnowledgeServerConfig, type KnowledgeText, type KnowledgeWrite, type ToolTransport } from '../../../shared/knowledge/types';
import { buildCrtxUri, crtxReaderUrl, parseCrtxUri } from '../../../shared/knowledge/crtxUri';

interface CrtxHit { vault: string; file: string; heading: string; date?: string; tags?: string[]; snippet?: string; uri?: string; text?: string }

// - the server wraps some results as {result: …}; others come bare
function unwrap<T>(x: unknown): T {
  const o = x as { result?: T };
  return (o && typeof o === 'object' && 'result' in o ? o.result : x) as T;
}

const titleOf = (r: { file: string; heading: string }) => r.heading ? `${r.file} › ${r.heading}` : r.file;

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

export function createCrtxProvider(config: KnowledgeServerConfig, transport: ToolTransport): KnowledgeProvider {
  return {
    name: config.name,
    kind: 'crtx',
    capabilities: { scopes: true, tags: true, recency: true, facets: true, write: true },

    async search(q: KnowledgeQuery): Promise<KnowledgeHit[]> {
      const args: Record<string, unknown> = { query: q.text, top: q.top, full_text: false };
      if (q.scope && q.scope !== 'all') args.vault = q.scope;
      if (q.tags?.length) args.tags = q.tags;
      if (q.recency) args.recency = true;
      const hits = unwrap<CrtxHit[]>(await transport.callTool('search', args)) ?? [];
      return hits.map(h => ({
        server: config.name,
        uri: h.uri ?? buildCrtxUri({ vault: h.vault, file: h.file, heading: h.heading ?? '' }),
        title: titleOf({ file: h.file, heading: h.heading ?? '' }),
        subtitle: h.vault,
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
      return { uri, title: titleOf(r), text: asText(unwrap(text)), fetchedAt: new Date().toISOString() };
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
