# Knowledge Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Ctrl+F` opens a search over configured knowledge servers (crtx first); `Enter` puts the highlighted result on the canvas as a `knowledge` node that keeps a cached copy of the text and refreshes it from the server without blocking the canvas.

**Architecture:** The dialog and the node depend only on `KnowledgeProvider` (spec §2). A generic streamable-HTTP JSON-RPC transport (`callTool`) lives in the extension host; one adapter file per server kind maps tools to the interface (`crtx` in v1). `KnowledgeService` in the host owns the providers and answers webview messages; a refresh scheduler (pure) plus a host runner refresh stale nodes with bounded concurrency and batched results. Spec: `docs/superpowers/specs/2026-09-19-knowledge-search-design.md`.

**Tech Stack:** TypeScript, React 18 + React Flow 12 (webview), VS Code extension host (Node 20+, global `fetch`), esbuild, `node:test` suites in `test/*.mjs` bundled to `test/.build/` (`test/` is git-ignored — never `git add` under it).

**House rules (from CLAUDE.md, mandatory):** commit messages = subject line only, plain English, no trailer of any kind (no `Co-Authored-By`, no "Generated with", no session link). Comments start with `// - `, terse, only the why; no banner or divider comments. Modern TS annotations, no `any` except where the surrounding glue already uses it. No metaphor nouns in names or comments ("gate", "guard", "funnel"…): name the check or the thing. Multi-step shell scripts start with `set -e`. One implementer at a time; stage only named files.

**Branch:** `feature/spatial-notebook` (current). Do not touch `.canvas` files.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/knowledge/types.ts` | `KnowledgeQuery`, `KnowledgeHit`, `KnowledgeText`, `KnowledgeWrite`, `KnowledgeProvider`, `KnowledgeServerConfig`, `KnowledgeCapabilities` |
| `src/shared/knowledge/jsonrpc.ts` | pure JSON-RPC framing: `buildRequest`, `parseJsonBody`, `parseSseBody`, `pickResponse` |
| `src/shared/knowledge/crtxUri.ts` | `parseCrtxUri`, `buildCrtxUri`, `crtxReaderUrl` |
| `src/shared/knowledge/refresh.ts` | pure: `staleNodes`, `applyRefreshResult`, `RefreshQueue` (concurrency + batching as state transitions) |
| `src/extension/knowledge/mcpHttpClient.ts` | `McpHttpClient` (`initialize`, `callTool`) over `fetch` |
| `src/extension/knowledge/adapters/crtx.ts` | `createCrtxProvider(config, transport)` |
| `src/extension/knowledge/registry.ts` | `createProvider(config, transport)` by `kind` |
| `src/extension/knowledge/service.ts` | `KnowledgeService`: providers from settings, message handlers, refresh runner |
| `src/extension/settings.ts` | `getKnowledgeServers()`, `getKnowledgeRefreshAfterHours()` |
| `src/shared/types.ts` | `KnowledgeNode`, new messages both directions |
| `src/webview/canvas/nodes/KnowledgeNode.tsx` | the node |
| `src/webview/canvas/KnowledgeSearch.tsx` | the dialog |
| `src/webview/canvas/knowledgeSearchState.ts` | pure reducer for the dialog's keyboard/state |
| `src/webview/canvas/CanvasView.tsx` | key wiring, node add, refresh apply, `changed` clear |
| `src/extension/editor-provider.ts` | route knowledge messages to the service; refresh on open |
| `src/extension/mcp/server.ts` | `canvas_add_knowledge`, `canvas_refresh_knowledge` |
| `src/webview/canvas/palette.ts`, `src/shared/constants.ts` | border colour, default size |
| `package.json` | `skena.knowledge.servers`, `skena.knowledge.refreshAfterHours` |
| `test/knowledge-jsonrpc.mjs`, `test/knowledge-crtx.mjs`, `test/knowledge-refresh.mjs`, `test/knowledge-search-state.mjs`, `test/mcp-parity.mjs` | suites |

Test bundling pattern (from `test/spatial-nav.mjs`): `npx esbuild <src>.ts --bundle --format=esm --outfile=test/.build/<name>.mjs && node --test test/<suite>.mjs`. Host modules under test must not import `vscode`.

---

### Task 1: Shared types and JSON-RPC framing

**Files:**
- Create: `src/shared/knowledge/types.ts`
- Create: `src/shared/knowledge/jsonrpc.ts`
- Test: `test/knowledge-jsonrpc.mjs`

- [ ] **Step 1: Write the types**

```ts
// src/shared/knowledge/types.ts
export interface KnowledgeQuery { text: string; scope?: string; tags?: string[]; recency?: boolean; top: number }

export interface KnowledgeHit {
  server:    string;
  uri:       string;
  title:     string;
  subtitle?: string;
  date?:     string;
  tags:      string[];
  snippet:   string;
}

export interface KnowledgeText { uri: string; title: string; text: string; fetchedAt: string }

export interface KnowledgeWrite {
  title:  string;
  text:   string;
  tags?:  string[];
  scope?: string;
  source: { canvas: string; nodeIds: string[]; kind: 'node' | 'output' | 'group' | 'ai' };
}

export interface KnowledgeCapabilities { scopes: boolean; tags: boolean; recency: boolean; facets: boolean; write: boolean }

export interface KnowledgeProvider {
  readonly name: string;
  readonly kind: string;
  readonly capabilities: KnowledgeCapabilities;
  search(q: KnowledgeQuery): Promise<KnowledgeHit[]>;
  fetch(uri: string): Promise<KnowledgeText>;
  scopes(): Promise<string[]>;
  facets(scope?: string): Promise<{ tags: [string, number][] }>;
  openUrl(uri: string): string | undefined;
  write(item: KnowledgeWrite): Promise<{ uri: string }>;
  append(uri: string, item: KnowledgeWrite): Promise<void>;
}

export interface KnowledgeServerConfig { name: string; kind: string; url: string; token?: string }

/** - the one thing an adapter needs from a transport */
export interface ToolTransport { callTool(name: string, args: Record<string, unknown>): Promise<unknown> }

/** - thrown by adapters when a uri no longer resolves (heading or page gone); refresh keeps the old text */
export class KnowledgeGoneError extends Error {}
```

- [ ] **Step 2: Write the failing framing tests**

```js
// test/knowledge-jsonrpc.mjs
// - run: npx esbuild src/shared/knowledge/jsonrpc.ts --bundle --format=esm --outfile=test/.build/jsonrpc.mjs && node --test test/knowledge-jsonrpc.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildRequest, parseJsonBody, parseSseBody, pickResponse, toolResultText } from './.build/jsonrpc.mjs';

test('buildRequest frames a tools/call with an id', () => {
  const r = buildRequest(7, 'tools/call', { name: 'search', arguments: { query: 'x' } });
  assert.deepEqual(JSON.parse(r), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } });
});

test('parseJsonBody returns the one message', () => {
  assert.deepEqual(parseJsonBody('{"jsonrpc":"2.0","id":7,"result":{"ok":1}}'), [{ jsonrpc: '2.0', id: 7, result: { ok: 1 } }]);
});

test('parseSseBody returns every message event, ignoring comments and other events', () => {
  const body = ': keepalive\n\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\nevent: ping\ndata: {}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n';
  assert.deepEqual(parseSseBody(body).map(m => m.id), [1, 2]);
});

test('parseSseBody joins multi-line data', () => {
  const body = 'data: {"jsonrpc":"2.0",\ndata: "id":3,"result":{}}\n\n';
  assert.equal(parseSseBody(body)[0].id, 3);
});

test('pickResponse finds the message by id and surfaces a JSON-RPC error as an Error', () => {
  const msgs = [{ jsonrpc: '2.0', id: 1, result: { x: 1 } }, { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad vault' } }];
  assert.deepEqual(pickResponse(msgs, 1), { x: 1 });
  assert.throws(() => pickResponse(msgs, 2), /bad vault/);
  assert.throws(() => pickResponse(msgs, 3), /no response/);
});

test('toolResultText joins the text parts of an MCP tool result and parses JSON when it is JSON', () => {
  const res = { content: [{ type: 'text', text: '{"result":[{"name":"crtx"}]}' }] };
  assert.deepEqual(toolResultText(res), { result: [{ name: 'crtx' }] });
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'plain' }, { type: 'text', text: ' more' }] }), 'plain more');
  assert.throws(() => toolResultText({ isError: true, content: [{ type: 'text', text: 'heading not found: a, b' }] }), /heading not found/);
});
```

- [ ] **Step 3: Run to verify it fails** — `npx esbuild src/shared/knowledge/jsonrpc.ts --bundle --format=esm --outfile=test/.build/jsonrpc.mjs` fails (file missing).

- [ ] **Step 4: Implement**

```ts
// src/shared/knowledge/jsonrpc.ts
export interface RpcMessage { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function buildRequest(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
}

export function parseJsonBody(body: string): RpcMessage[] {
  const v = JSON.parse(body) as RpcMessage | RpcMessage[];
  return Array.isArray(v) ? v : [v];
}

// - SSE: events separated by a blank line; `data:` lines of one event are joined with '\n';
//   comment lines start with ':'; only events whose data parses as JSON-RPC are returned
export function parseSseBody(body: string): RpcMessage[] {
  const out: RpcMessage[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { const m = JSON.parse(data) as RpcMessage; if (m && m.jsonrpc === '2.0') out.push(m); } catch { /* - not JSON-RPC: a ping or a comment */ }
  }
  return out;
}

export function pickResponse(msgs: RpcMessage[], id: number): unknown {
  const m = msgs.find(x => x.id === id);
  if (!m) throw new Error(`no response for request ${id}`);
  if (m.error) throw new Error(m.error.message);
  return m.result;
}

// - MCP tool results carry `content: [{type:'text', text}]`; servers put JSON in the text
export function toolResultText(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  if (r.isError) throw new Error(text || 'tool error');
  try { return JSON.parse(text); } catch { return text; }
}
```

- [ ] **Step 5: Run the suite** — expected 6/6 pass. `npm run typecheck` — only the 3 pre-existing errors at `src/extension/editor-provider.ts:488-490`.

- [ ] **Step 6: Commit** — `git add src/shared/knowledge/types.ts src/shared/knowledge/jsonrpc.ts` · `git commit -m "feat: knowledge provider types and JSON-RPC framing"`

---

### Task 2: The HTTP transport

**Files:**
- Create: `src/extension/knowledge/mcpHttpClient.ts`
- Test: `test/knowledge-http.mjs` (a local `node:http` server standing in for the MCP server)

- [ ] **Step 1: Write the failing test**

```js
// test/knowledge-http.mjs
// - run: npx esbuild src/extension/knowledge/mcpHttpClient.ts --bundle --format=esm --platform=node --outfile=test/.build/mcpHttpClient.mjs && node --test test/knowledge-http.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import { McpHttpClient } from './.build/mcpHttpClient.mjs';

function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => handler(req, JSON.parse(b), res)); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/mcp` }));
  });
}

test('initialize once, then tools/call; bearer and session id travel; JSON and SSE bodies both work', async () => {
  const seen = [];
  const { srv, url } = await serve((req, msg, res) => {
    seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'], method: msg.method });
    if (msg.method === 'initialize') { res.setHeader('Mcp-Session-Id', 's1'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26' } })); return; }
    if (msg.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    res.setHeader('content-type', 'text/event-stream');
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '{"result":[1]}' }] } })}\n\n`);
  });
  const c = new McpHttpClient({ url, token: 'tok', timeoutMs: 2000 });
  const r = await c.callTool('search', { query: 'x' });
  assert.deepEqual(r, { result: [1] });
  assert.equal(seen[0].method, 'initialize'); assert.equal(seen[0].auth, 'Bearer tok');
  assert.equal(seen.at(-1).method, 'tools/call'); assert.equal(seen.at(-1).session, 's1');
  await c.callTool('search', { query: 'y' });
  assert.equal(seen.filter(s => s.method === 'initialize').length, 1);
  srv.close();
});

test('a server that does not answer in time rejects with a plain message', async () => {
  const { srv, url } = await serve(() => { /* - never respond */ });
  const c = new McpHttpClient({ url, timeoutMs: 100 });
  await assert.rejects(c.callTool('search', {}), /timed out/);
  srv.close();
});

test('an HTTP error status rejects with the status', async () => {
  const { srv, url } = await serve((req, msg, res) => { res.statusCode = 401; res.end('no'); });
  const c = new McpHttpClient({ url, timeoutMs: 1000 });
  await assert.rejects(c.callTool('search', {}), /401/);
  srv.close();
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
// src/extension/knowledge/mcpHttpClient.ts
import { buildRequest, parseJsonBody, parseSseBody, pickResponse, toolResultText } from '../../shared/knowledge/jsonrpc';
import type { ToolTransport } from '../../shared/knowledge/types';

export interface McpHttpClientOptions { url: string; token?: string; timeoutMs?: number; clientName?: string }

// - streamable HTTP: every request is a POST; the reply is JSON or an SSE stream holding the reply
export class McpHttpClient implements ToolTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialized: Promise<void> | undefined;

  constructor(private readonly opts: McpHttpClientOptions) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    const result = await this.request('tools/call', { name, arguments: args });
    return toolResultText(result);
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= (async () => {
      await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: this.opts.clientName ?? 'skena', version: '1' },
      });
      await this.post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), false);
    })().catch(e => { this.initialized = undefined; throw e; });
    return this.initialized;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msgs = await this.post(buildRequest(id, method, params), true);
    return pickResponse(msgs, id);
  }

  private async post(body: string, expectReply: boolean) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 5000);
    try {
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body,
        signal: ctl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.opts.url}`);
      if (!expectReply) return [];
      const text = await res.text();
      return (res.headers.get('content-type') ?? '').includes('text/event-stream') ? parseSseBody(text) : parseJsonBody(text);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`${this.opts.url} timed out after ${this.opts.timeoutMs ?? 5000} ms`);
      throw e;
    } finally { clearTimeout(timer); }
  }
}
```

- [ ] **Step 4: Run the suite** — 3/3. Typecheck: `fetch`/`AbortController` need `lib: ["dom"]` or `@types/node` ≥ 18 — check `tsconfig.json`; if `fetch` is not in scope, add `"lib": [..., "DOM"]` only to the extension tsconfig, or declare `declare const fetch: typeof globalThis.fetch` — report which.

- [ ] **Step 5: Commit** — `git add src/extension/knowledge/mcpHttpClient.ts` · `git commit -m "feat: streamable-HTTP MCP client for knowledge servers"`

---

### Task 3: crtx adapter, uri helpers, registry

**Files:**
- Create: `src/shared/knowledge/crtxUri.ts`, `src/extension/knowledge/adapters/crtx.ts`, `src/extension/knowledge/registry.ts`
- Test: `test/knowledge-crtx.mjs`

Server facts (measured): `search(query, vault?, tags?, recency?, top, full_text)` hit = `{vault, file, heading, date, tags, id, project, snippet, uri, text?}`; `read_section(vault, file, heading)` → the section's markdown as the text part (raise names the real headings); `read(vault, file)` → the file; `list_vaults` → `{result: [{name, path}]}`; `facets(vault?)` → `{tags: [[name, count]], projects: [...]}`; `create_note` / `append_note` exist — read their argument names off the live schema (`tools/list`) before mapping and write them into the adapter; `uri` = `crtx://<vault>/<file>#<heading>`; reader = `http://<host>:8787/#<vault>/<encoded file>`. Results arrive through `toolResultText` — either a parsed object (`{result: [...]}` or a bare array/object) or a string; write `unwrap(x)` = `x.result ?? x` and test both shapes.

- [ ] **Step 1: Write the failing tests**

```js
// test/knowledge-crtx.mjs
// - run: npx esbuild src/extension/knowledge/adapters/crtx.ts --bundle --format=esm --platform=node --outfile=test/.build/crtxAdapter.mjs && npx esbuild src/shared/knowledge/crtxUri.ts --bundle --format=esm --outfile=test/.build/crtxUri.mjs && node --test test/knowledge-crtx.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCrtxUri, buildCrtxUri, crtxReaderUrl } from './.build/crtxUri.mjs';
import { createCrtxProvider } from './.build/crtxAdapter.mjs';

test('uri round-trips, with and without a heading', () => {
  assert.deepEqual(parseCrtxUri('crtx://crtx/projects/skena.md#2026-09-19 — state'), { vault: 'crtx', file: 'projects/skena.md', heading: '2026-09-19 — state' });
  assert.deepEqual(parseCrtxUri('crtx://lib/a b.md'), { vault: 'lib', file: 'a b.md', heading: '' });
  assert.equal(buildCrtxUri({ vault: 'lib', file: 'papers/a.md', heading: 'First' }), 'crtx://lib/papers/a.md#First');
  assert.throws(() => parseCrtxUri('notion://x'), /crtx/);
});

test('reader url encodes the file and points at port 8787 of the server host', () => {
  assert.equal(crtxReaderUrl('crtx://lib/papers/a b.md#x', 'http://aurora-1:8788/mcp'), 'http://aurora-1:8787/#lib/papers%2Fa%20b.md');
});

function fake(answers) {
  const calls = [];
  return { calls, callTool: async (name, args) => { calls.push({ name, args }); const a = answers[name]; if (a instanceof Error) throw a; return typeof a === 'function' ? a(args) : a; } };
}

test('search maps hits and passes filters; full_text is off', async () => {
  const t = fake({ search: { result: [{ vault: 'crtx', file: 'log.md', heading: 'h', date: '2026-09-19', tags: ['a'], id: 'x', project: 'p', snippet: 'snip', uri: 'crtx://crtx/log.md#h' }] } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const hits = await p.search({ text: 'q', scope: 'crtx', tags: ['a'], recency: true, top: 20 });
  assert.deepEqual(t.calls[0], { name: 'search', args: { query: 'q', vault: 'crtx', tags: ['a'], recency: true, top: 20, full_text: false } });
  assert.deepEqual(hits, [{ server: 'crtx', uri: 'crtx://crtx/log.md#h', title: 'log.md › h', subtitle: 'crtx', date: '2026-09-19', tags: ['a'], snippet: 'snip' }]);
});

test('search with scope "all" or undefined sends no vault; a bare array result is accepted', async () => {
  const t = fake({ search: [] });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  await p.search({ text: 'q', top: 5 });
  assert.equal('vault' in t.calls[0].args, false);
});

test('fetch reads one section, or the file when the heading is empty; a missing heading is KnowledgeGoneError', async () => {
  const t = fake({ read_section: 'sec text', read: 'file text' });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const a = await p.fetch('crtx://crtx/log.md#h');
  assert.equal(a.text, 'sec text'); assert.equal(a.title, 'log.md › h'); assert.match(a.fetchedAt, /^\d{4}-/);
  assert.deepEqual(t.calls[0], { name: 'read_section', args: { vault: 'crtx', file: 'log.md', heading: 'h' } });
  const b = await p.fetch('crtx://crtx/log.md'); assert.equal(b.text, 'file text');
  const gone = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({ read_section: new Error('heading not found: x; have: a, b') }));
  await assert.rejects(gone.fetch('crtx://crtx/log.md#x'), e => e.name === 'KnowledgeGoneError');
});

test('scopes and facets', async () => {
  const t = fake({ list_vaults: { result: [{ name: 'crtx', path: '/x' }, { name: 'diary', path: '/y' }] }, facets: { tags: [['research', 12], ['bug', 3]], projects: [['skena', 5]] } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  assert.deepEqual(await p.scopes(), ['crtx', 'diary']);
  assert.deepEqual(await p.facets('crtx'), { tags: [['research', 12], ['bug', 3]] });
  assert.deepEqual(t.calls[1].args, { vault: 'crtx' });
});

test('capabilities and openUrl', () => {
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://aurora-1:8788/mcp' }, fake({}));
  assert.deepEqual(p.capabilities, { scopes: true, tags: true, recency: true, facets: true, write: true });
  assert.equal(p.openUrl('crtx://lib/a.md#h'), 'http://aurora-1:8787/#lib/a.md');
});
```

Add `write`/`append` tests once the argument names are read off the live server (Step 3); they assert the exact `callTool` args.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Read the live write-tool schema** — `curl -s -X POST http://aurora-1:8788/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}'` then `tools/list` with the returned `Mcp-Session-Id`; the token is `CRTX_AUTH_TOKEN` in `~/.crtx-server/auth.env`. Record the `create_note` / `append_note` parameter names in the adapter's comment. If the server cannot be reached, map to the names in the spec and mark the two methods with `// - argument names unverified` and say so in the report.

- [ ] **Step 4: Implement**

```ts
// src/shared/knowledge/crtxUri.ts
export interface CrtxRef { vault: string; file: string; heading: string }

export function parseCrtxUri(uri: string): CrtxRef {
  const m = /^crtx:\/\/([^/]+)\/([^#]*)(?:#(.*))?$/.exec(uri);
  if (!m) throw new Error(`not a crtx uri: ${uri}`);
  return { vault: m[1], file: m[2], heading: m[3] ?? '' };
}

export function buildCrtxUri(r: CrtxRef): string {
  return `crtx://${r.vault}/${r.file}${r.heading ? `#${r.heading}` : ''}`;
}

// - the web reader lives on port 8787 of the same host; it jumps to the heading by text match
export function crtxReaderUrl(uri: string, serverUrl: string): string {
  const r = parseCrtxUri(uri);
  const host = new URL(serverUrl).hostname;
  return `http://${host}:8787/#${r.vault}/${encodeURIComponent(r.file)}`;
}
```

```ts
// src/extension/knowledge/adapters/crtx.ts
import { KnowledgeGoneError, type KnowledgeHit, type KnowledgeProvider, type KnowledgeQuery, type KnowledgeServerConfig, type KnowledgeText, type KnowledgeWrite, type ToolTransport } from '../../../shared/knowledge/types';
import { buildCrtxUri, crtxReaderUrl, parseCrtxUri } from '../../../shared/knowledge/crtxUri';

interface CrtxHit { vault: string; file: string; heading: string; date?: string; tags?: string[]; snippet?: string; uri?: string; text?: string }

// - the server wraps some results as {result: …}; others come bare
function unwrap<T>(x: unknown): T {
  const o = x as { result?: T };
  return (o && typeof o === 'object' && 'result' in o ? o.result : x) as T;
}

const titleOf = (r: { file: string; heading: string }) => r.heading ? `${r.file} › ${r.heading}` : r.file;

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

    async fetch(uri: string): Promise<KnowledgeText> {
      const r = parseCrtxUri(uri);
      let text: unknown;
      try {
        text = r.heading
          ? await transport.callTool('read_section', { vault: r.vault, file: r.file, heading: r.heading })
          : await transport.callTool('read', { vault: r.vault, file: r.file });
      } catch (e) {
        if (/not found|no such|unknown/i.test((e as Error).message)) throw new KnowledgeGoneError((e as Error).message);
        throw e;
      }
      return { uri, title: titleOf(r), text: String(unwrap(text) ?? ''), fetchedAt: new Date().toISOString() };
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

    // - argument names read off the live tools/list on <date>; update here if the server changes
    async write(item: KnowledgeWrite) {
      const res = unwrap<{ uri?: string; file?: string; vault?: string }>(await transport.callTool('create_note', {
        vault: item.scope ?? 'crtx', title: item.title, text: item.text, ...(item.tags?.length ? { tags: item.tags } : {}),
      }));
      return { uri: res?.uri ?? buildCrtxUri({ vault: res?.vault ?? item.scope ?? 'crtx', file: res?.file ?? '', heading: '' }) };
    },
    async append(uri: string, item: KnowledgeWrite) {
      const r = parseCrtxUri(uri);
      await transport.callTool('append_note', { vault: r.vault, file: r.file, text: item.text });
    },
  };
}
```

```ts
// src/extension/knowledge/registry.ts
import type { KnowledgeProvider, KnowledgeServerConfig, ToolTransport } from '../../shared/knowledge/types';
import { createCrtxProvider } from './adapters/crtx';

const KINDS: Record<string, (c: KnowledgeServerConfig, t: ToolTransport) => KnowledgeProvider> = {
  crtx: createCrtxProvider,
};

export function createProvider(config: KnowledgeServerConfig, transport: ToolTransport): KnowledgeProvider {
  const make = KINDS[config.kind];
  if (!make) throw new Error(`unknown knowledge server kind "${config.kind}" (known: ${Object.keys(KINDS).join(', ')})`);
  return make(config, transport);
}
export const KNOWN_KINDS = Object.keys(KINDS);
```

- [ ] **Step 5: Run the suite** (all pass) and typecheck.

- [ ] **Step 6: Commit** — `git add src/shared/knowledge/crtxUri.ts src/extension/knowledge/adapters/crtx.ts src/extension/knowledge/registry.ts` · `git commit -m "feat: crtx knowledge adapter, uri helpers and the adapter registry"`

---

### Task 4: Settings, service, host messages

**Files:**
- Modify: `package.json` (contributes.configuration), `src/extension/settings.ts`, `src/shared/types.ts`, `src/extension/editor-provider.ts`
- Create: `src/extension/knowledge/service.ts`

- [ ] **Step 1: package.json** — add after `skena.notion`:

```jsonc
"skena.knowledge.servers": {
  "type": "array", "default": [], "scope": "window",
  "markdownDescription": "Knowledge servers for `Ctrl+F` search. Each item: `{ name, kind, url, token }`. `kind` selects the adapter (`crtx`). Put the entry with the token in `.vscode/settings.local.json`.",
  "items": { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "type": "string" }, "url": { "type": "string" }, "token": { "type": "string" } }, "required": ["name", "kind", "url"] }
},
"skena.knowledge.refreshAfterHours": { "type": "number", "default": 24, "scope": "window", "description": "A knowledge node older than this is refreshed from its server when the canvas opens." }
```

- [ ] **Step 2: settings.ts** — same shape as `getVaults`:

```ts
export async function getKnowledgeServers(): Promise<KnowledgeServerConfig[]> {
  const [local, base] = await readWorkspaceSettings();
  if (Array.isArray(local?.['skena.knowledge.servers'])) return local!['skena.knowledge.servers'] as KnowledgeServerConfig[];
  if (Array.isArray(base?.['skena.knowledge.servers']))  return base!['skena.knowledge.servers'] as KnowledgeServerConfig[];
  return vscode.workspace.getConfiguration('skena').get<KnowledgeServerConfig[]>('knowledge.servers') ?? [];
}
export async function getKnowledgeRefreshAfterHours(): Promise<number> {
  const [local, base] = await readWorkspaceSettings();
  const v = local?.['skena.knowledge.refreshAfterHours'] ?? base?.['skena.knowledge.refreshAfterHours']
    ?? vscode.workspace.getConfiguration('skena').get<number>('knowledge.refreshAfterHours');
  return typeof v === 'number' && v >= 0 ? v : 24;
}
```

- [ ] **Step 3: shared/types.ts messages** — webview → host (add to `WebviewToHost`):

```ts
export interface MsgKnowledgeServers { type: 'knowledgeServers' }
export interface MsgKnowledgeSearch  { type: 'knowledgeSearch'; requestId: number; server: string; query: KnowledgeQuery }
export interface MsgKnowledgeFetch   { type: 'knowledgeFetch';  requestId: number; server: string; uri: string }
export interface MsgKnowledgeScopes  { type: 'knowledgeScopes'; requestId: number; server: string }
export interface MsgKnowledgeFacets  { type: 'knowledgeFacets'; requestId: number; server: string; scope?: string }
export interface MsgKnowledgeRefresh { type: 'knowledgeRefresh'; nodes: { id: string; server: string; uri: string; text: string }[] }
export interface MsgKnowledgeOpen    { type: 'knowledgeOpen'; server: string; uri: string }
```

host → webview (add to `HostToWebview`):

```ts
export interface MsgKnowledgeServersResult { type: 'knowledgeServersResult'; servers: { name: string; kind: string; capabilities: KnowledgeCapabilities; error?: string }[] }
export interface MsgKnowledgeSearchResult  { type: 'knowledgeSearchResult'; requestId: number; hits?: KnowledgeHit[]; error?: string }
export interface MsgKnowledgeFetchResult   { type: 'knowledgeFetchResult';  requestId: number; text?: KnowledgeText; error?: string }
export interface MsgKnowledgeScopesResult  { type: 'knowledgeScopesResult'; requestId: number; scopes?: string[]; error?: string }
export interface MsgKnowledgeFacetsResult  { type: 'knowledgeFacetsResult'; requestId: number; tags?: [string, number][]; error?: string }
export interface MsgKnowledgeRefreshed     { type: 'knowledgeRefreshed'; nodes: { id: string; text?: string; title?: string; fetchedAt?: string; changed?: boolean; error?: string }[] }
```

and the node:

```ts
export interface KnowledgeNode extends CanvasNodeBase {
  type: 'knowledge';
  server: string;
  uri: string;
  title: string;
  text: string;
  fetchedAt: string;
  changed?: boolean;
  error?: string;
}
```
Add `KnowledgeNode` to the `CanvasNode` union. Import the knowledge types from `./knowledge/types`.

- [ ] **Step 4: service.ts**

```ts
// src/extension/knowledge/service.ts
import type { KnowledgeProvider, KnowledgeServerConfig } from '../../shared/knowledge/types';
import { createProvider, KNOWN_KINDS } from './registry';
import { McpHttpClient } from './mcpHttpClient';

export class KnowledgeService {
  private providers = new Map<string, KnowledgeProvider>();
  private errors = new Map<string, string>();

  configure(servers: KnowledgeServerConfig[]): void {
    this.providers.clear(); this.errors.clear();
    for (const s of servers) {
      try { this.providers.set(s.name, createProvider(s, new McpHttpClient({ url: s.url, token: s.token }))); }
      catch (e) { this.errors.set(s.name, (e as Error).message); }
    }
  }
  list() {
    return [
      ...[...this.providers.values()].map(p => ({ name: p.name, kind: p.kind, capabilities: p.capabilities })),
      ...[...this.errors].map(([name, error]) => ({ name, kind: 'unknown', capabilities: { scopes: false, tags: false, recency: false, facets: false, write: false }, error })),
    ];
  }
  provider(name: string): KnowledgeProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`no knowledge server "${name}" (known kinds: ${KNOWN_KINDS.join(', ')})`);
    return p;
  }
}
```

- [ ] **Step 5: editor-provider.ts** — one `KnowledgeService` per provider instance, configured on `webviewReady` (re-read settings each time so a token edit takes effect on reload); handlers in the message switch, each answering with the matching result message and `{ error }` on rejection:

```ts
case 'knowledgeServers': { await this.knowledge.configure(await getKnowledgeServers()); send({ type: 'knowledgeServersResult', servers: this.knowledge.list() }); break; }
case 'knowledgeSearch': { try { send({ type: 'knowledgeSearchResult', requestId: msg.requestId, hits: await this.knowledge.provider(msg.server).search(msg.query) }); } catch (e) { send({ type: 'knowledgeSearchResult', requestId: msg.requestId, error: (e as Error).message }); } break; }
// - knowledgeFetch / knowledgeScopes / knowledgeFacets: same shape
case 'knowledgeOpen': { const url = this.knowledge.provider(msg.server).openUrl(msg.uri); if (url) await vscode.env.openExternal(vscode.Uri.parse(url)); break; }
```
`knowledgeRefresh` is Task 7.

- [ ] **Step 6: typecheck + build** (`npm run build`, grep the whole output for errors). No suite yet for the service — it is glue; covered by Task 6's smoke.

- [ ] **Step 7: Commit** — `git add package.json src/extension/settings.ts src/shared/types.ts src/extension/knowledge/service.ts src/extension/editor-provider.ts` · `git commit -m "feat: knowledge servers in settings; host service answers search, fetch, scopes, facets and open"`

---

### Task 5: The knowledge node

**Files:**
- Create: `src/webview/canvas/nodes/KnowledgeNode.tsx`
- Modify: `src/webview/canvas/palette.ts` (`DEFAULT_NODE_BORDER_BY_TYPE.knowledge: '#3b9ad9'`), `src/shared/constants.ts` (`NODE_SIZE.knowledge: { w: 700, h: 300 }`), `src/webview/canvas/CanvasView.tsx` (`NODE_TYPES.knowledge`, `toFlowNode` passes the fields through as it does for text), `src/extension/mcp/server.ts` (`canvas_list`/`canvas_read` show `knowledge` nodes: title + uri + fetchedAt, text body).

- [ ] **Step 1: Component** — follow `TextNodeComponent`'s read-only branch: `useSelectedStyle`, `useZoomInvariantBorderWidth(1.5)`, `nodeBorderColor('knowledge', node.accentColor)`, `NodeLabelBadge`, `Handle`s and `NodeResizer` as the text node has them. Header (one line, 12 px): `{server} › {title} · {ago(fetchedAt)}`, a `●` before the title while `node.changed`, `title` attribute = `error ?? uri`; two buttons at the right: `↻` (dispatches `skena:knowledgeRefresh` with `{ id }`) and `↗` (posts `knowledgeOpen`). Body: `ScrollableContent` with `useHostMarkdown(node.text)` / `MarkdownRenderer` exactly as `TextNode.tsx:1002-1008`. No edit mode; `Enter` on the node does nothing (no `autoEdit`).
`ago()` = a small pure helper in the component file: `< 1 min` → "now", minutes, hours, days.

- [ ] **Step 2: Wire** — `NODE_TYPES.knowledge = KnowledgeNodeComponent`; `toFlowNode` needs no change if it spreads `cn` into `data` (check `CanvasView.tsx:147-160`); in `server.ts` `canvas_read` prints `Format: knowledge`, the uri, `fetchedAt`, then the text; `canvas_list` shows `title`.
Layout engine: nothing — a `knowledge` node is neither an output nor a kernel, so `isMember` already includes it; confirm with a one-line probe in `test/layout-engine.mjs` (a `knowledge` node at a column x is packed like a text node).

- [ ] **Step 3: typecheck + build**, then the probe test passes.

- [ ] **Step 4: Commit** — `git commit -m "feat: knowledge node — cached text with a header naming the server, the source and its age"`

---

### Task 6: The dialog

**Files:**
- Create: `src/webview/canvas/knowledgeSearchState.ts` (pure), `src/webview/canvas/KnowledgeSearch.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx` (keys, open/close, add node), `src/webview/canvas/CanvasSearch.tsx` (drop the `Ctrl+F` handling at `:109`)
- Test: `test/knowledge-search-state.mjs`

- [ ] **Step 1: Pure state**

```ts
// src/webview/canvas/knowledgeSearchState.ts
import type { KnowledgeCapabilities, KnowledgeHit } from '../../shared/knowledge/types';

export interface SearchState {
  server: string; servers: { name: string; capabilities: KnowledgeCapabilities }[];
  query: string; scope: string; scopes: string[]; recency: boolean;
  hits: KnowledgeHit[]; highlight: number; status: string;
}

export type SearchAction =
  | { kind: 'type'; query: string } | { kind: 'hits'; hits: KnowledgeHit[] } | { kind: 'error'; message: string }
  | { kind: 'move'; by: 1 | -1 } | { kind: 'cycleScope' } | { kind: 'scopes'; scopes: string[] }
  | { kind: 'toggleRecency' } | { kind: 'server'; name: string };

// - `#tag` tokens leave the query text and become the tags filter; the rest is the search text
export function splitTags(query: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = query.replace(/(^|\s)#([\w-]+)/g, (_, sp: string, t: string) => { tags.push(t); return sp; }).replace(/\s+/g, ' ').trim();
  return { text, tags };
}

export function reduce(s: SearchState, a: SearchAction): SearchState {
  switch (a.kind) {
    case 'type':          return { ...s, query: a.query };
    case 'hits':          return { ...s, hits: a.hits, highlight: 0, status: `${a.hits.length} result${a.hits.length === 1 ? '' : 's'}` };
    case 'error':         return { ...s, hits: [], highlight: 0, status: a.message };
    case 'move':          return s.hits.length ? { ...s, highlight: (s.highlight + a.by + s.hits.length) % s.hits.length } : s;
    case 'scopes':        return { ...s, scopes: a.scopes };
    case 'cycleScope':    { const all = ['all', ...s.scopes]; const i = all.indexOf(s.scope); return { ...s, scope: all[(i + 1) % all.length] }; }
    case 'toggleRecency': return { ...s, recency: !s.recency };
    case 'server':        return { ...s, server: a.name, scope: 'all', scopes: [], hits: [], highlight: 0 };
  }
}

export const initialState = (servers: SearchState['servers']): SearchState =>
  ({ server: servers[0]?.name ?? '', servers, query: '', scope: 'all', scopes: [], recency: false, hits: [], highlight: 0, status: servers.length ? '' : 'no knowledge server configured (skena.knowledge.servers)' });
```

Tests (`test/knowledge-search-state.mjs`): `splitTags('mean #reversion rsi #bug')` → `{text: 'mean rsi', tags: ['reversion', 'bug']}`; `move` wraps both ways and is a no-op on empty hits; `cycleScope` walks `all → a → b → all`; `hits` resets highlight and writes the status; `server` resets scope and hits; `initialState([])` carries the no-server message.

- [ ] **Step 2: Component** — `KnowledgeSearch.tsx` renders from `SearchState` (`useReducer`), styled like `CanvasSearch` (same container, wider: `min(900px, 90%)`, two columns: list 55 % / preview 45 %). Behaviour per spec §7: on mount post `knowledgeServers`; on `knowledgeServersResult` set servers, then post `knowledgeScopes` when `capabilities.scopes`; query typing debounced 300 ms → `knowledgeSearch {server, query: {text, tags (only if capabilities.tags), scope (if not 'all'), recency, top: 20}}`; results matched by `requestId` (ignore stale); highlight change debounced 150 ms → `knowledgeFetch` unless cached (`Map<uri, KnowledgeText>` in a ref); preview shows the cached text through `MarkdownRenderer`; keys: `↑/↓` move, `Tab` cycleScope (when scopes), `Enter` → `onPick(hit, cachedText | null)`, `Esc` → `onClose`, `Ctrl+F` re-focuses the input; status line at the bottom: `{server} · {status}`; a server row with `error` is shown disabled with its message. Filters row hidden entirely when the provider has neither scopes nor recency.

- [ ] **Step 3: Wiring in CanvasView** — state `knowledgeOpen`; keydown at `CanvasView.tsx:~2320`: `Ctrl+F` (not in a field) → `setKnowledgeOpen(true)`; `/` alone → `setSearchOpen(true)` (remove `Ctrl+F` from that condition); in `CanvasSearch.tsx:109` delete the `Ctrl+F` line. `onPick(hit, text)`: if `text` is null, post `knowledgeFetch` and wait for its result (show "fetching…" in the status line; on error keep the dialog open with the message); then build the node:

```ts
const cn: KnowledgeNode = { id: `knowledge-${Date.now()}`, type: 'knowledge', x: 0, y: 0, width: NODE_SIZE.knowledge.w, height: NODE_SIZE.knowledge.h,
  server: hit.server, uri: hit.uri, title: text.title || hit.title, text: text.text, fetchedAt: text.fetchedAt, createdBy: 'user' };
```
place it with the paste rule (anchor = the focused non-band node → `directionSlot('L', …)`; else the pane-centre computation from `pasteInternalClipboard`), then dispatch `skena:addNodeResult` with `{ type: 'addNodeResult', node: cn, anchorId }` — that handler already labels, saves, runs the engine, focuses and reveals. Close the dialog. Then post `skena:codeHeight`-like sizing? No: the text-node rule sizes on render — check how a pasted text node gets its height; if text nodes have no auto-height, leave 300.

- [ ] **Step 4: Run** the state suite, typecheck, build. Smoke in a VSIX comes with Task 9.

- [ ] **Step 5: Commit** — `git add src/webview/canvas/knowledgeSearchState.ts src/webview/canvas/KnowledgeSearch.tsx src/webview/canvas/CanvasView.tsx src/webview/canvas/CanvasSearch.tsx` · `git commit -m "feat: Ctrl+F searches the knowledge servers; Enter puts the highlighted result on the canvas; / keeps find-in-canvas"`

---

### Task 7: Refresh

**Files:**
- Create: `src/shared/knowledge/refresh.ts`
- Modify: `src/extension/knowledge/service.ts` (runner), `src/extension/editor-provider.ts` (`knowledgeRefresh` handler; cancel on dispose), `src/webview/canvas/CanvasView.tsx` (send the stale list after `canvasLoaded`; apply `knowledgeRefreshed`; clear `changed` on focus; `skena:knowledgeRefresh` from the node button), `src/webview/canvas/nodes/KnowledgeNode.tsx` (header states)
- Test: `test/knowledge-refresh.mjs`

- [ ] **Step 1: Pure module**

```ts
// src/shared/knowledge/refresh.ts
export interface RefreshTarget { id: string; server: string; uri: string; text: string; fetchedAt: string }
export interface RefreshOutcome { id: string; text?: string; title?: string; fetchedAt?: string; changed?: boolean; error?: string }

export function staleTargets(nodes: RefreshTarget[], now: Date, afterHours: number): RefreshTarget[] {
  const limit = now.getTime() - afterHours * 3600_000;
  return nodes.filter(n => { const t = Date.parse(n.fetchedAt); return Number.isNaN(t) || t < limit; });
}

// - same text → only the timestamp moves; different text → changed; gone → old text kept, error shown
export function outcomeOf(target: RefreshTarget, result: { text: string; title: string; fetchedAt: string } | { gone: string } | { error: string }): RefreshOutcome {
  if ('error' in result) return { id: target.id, error: result.error };
  if ('gone' in result)  return { id: target.id, error: result.gone };
  if (result.text === target.text) return { id: target.id, fetchedAt: result.fetchedAt };
  return { id: target.id, text: result.text, title: result.title, fetchedAt: result.fetchedAt, changed: true };
}

// - the runner's bookkeeping as plain state: which ids are in flight per server, what is queued,
//   what is ready to send. The host drives it; tests drive it without timers.
export interface QueueState { pending: RefreshTarget[]; inFlight: Map<string, number>; ready: RefreshOutcome[]; stopped: Set<string> }
export const MAX_IN_FLIGHT = 3;

export function newQueue(targets: RefreshTarget[]): QueueState { return { pending: [...targets], inFlight: new Map(), ready: [], stopped: new Set() }; }

export function takeNext(q: QueueState): RefreshTarget | undefined {
  const i = q.pending.findIndex(t => !q.stopped.has(t.server) && (q.inFlight.get(t.server) ?? 0) < MAX_IN_FLIGHT);
  if (i < 0) return undefined;
  const [t] = q.pending.splice(i, 1);
  q.inFlight.set(t.server, (q.inFlight.get(t.server) ?? 0) + 1);
  return t;
}

export function settle(q: QueueState, t: RefreshTarget, o: RefreshOutcome, serverDown = false): void {
  q.inFlight.set(t.server, (q.inFlight.get(t.server) ?? 1) - 1);
  q.ready.push(o);
  if (serverDown) { q.stopped.add(t.server); q.pending = q.pending.filter(p => p.server !== t.server); }
}

export function drain(q: QueueState): RefreshOutcome[] { const r = q.ready; q.ready = []; return r; }
export function done(q: QueueState): boolean { return q.pending.length === 0 && [...q.inFlight.values()].every(n => n === 0); }
```

Tests: `staleTargets` with 25 h / 23 h / bad date; `outcomeOf` three branches; `takeNext` gives at most 3 per server and skips a stopped server; `settle(..., serverDown=true)` drops that server's pending; `drain` empties; `done`.

- [ ] **Step 2: Runner in `KnowledgeService`** — `startRefresh(targets, emit: (batch: RefreshOutcome[]) => void): { cancel(): void }`: loop `takeNext` while possible, each target → `provider.fetch(uri)` → `outcomeOf` (a `KnowledgeGoneError` → `{gone}`; a timeout / HTTP error → `{error}` and `serverDown = true`); a `setInterval` of 250 ms calls `emit(drain(q))` when non-empty; stop the interval when `done` or cancelled. One run per canvas at a time — a new `startRefresh` cancels the previous.

- [ ] **Step 3: Host + webview wiring** — webview: after `canvasLoaded` (and after the first paint: `requestAnimationFrame`), collect `knowledge` nodes → `staleTargets(nodes, new Date(), hours)` — the hours come with `knowledgeServersResult` (add `refreshAfterHours` to it) — and post `knowledgeRefresh {nodes}`; the node's `↻` button posts the same for one node (not stale-filtered). Host: `case 'knowledgeRefresh'` → `startRefresh(msg.nodes, batch => send({ type: 'knowledgeRefreshed', nodes: batch }))`; dispose cancels. Webview `knowledgeRefreshed`: apply each outcome to `canvasRef.current` + `setNodes` (fields only: `text/title/fetchedAt/changed/error`), one `scheduleSave()` per batch, no history entry. Focusing a knowledge node with `changed` clears it (in the same place focus is recorded — `recordPreviousPosition` or the selection change handler) and saves.

- [ ] **Step 4: Node header** — `●` while `changed`; `error` in the `title` attribute and a muted `!` after the age; nothing else.

- [ ] **Step 5: Run** the refresh suite, typecheck, build.

- [ ] **Step 6: Commit** — `git commit -m "feat: knowledge nodes refresh from their server on open when stale, three at a time per server, results batched; a changed node is marked"`

---

### Task 8: MCP parity

**Files:**
- Modify: `src/extension/mcp/server.ts`
- Test: `test/mcp-parity.mjs`

- [ ] **Step 1: Tools** — `canvas_add_knowledge {canvasPath, server, uri, title, text, after?, x?, y?}`: builds a `knowledge` node (`fetchedAt = now`, `createdBy: 'ai'`), placed like `canvas_add_node` (the `after` anchor path or `autoPlace`), engine + lane fit as the other adds; reply names the label. `canvas_refresh_knowledge {canvasPath, ref}`: sets `fetchedAt` to `1970-01-01T00:00:00Z` on the node so the next open refreshes it (the MCP process has no token), reply says so. Tool descriptions in the same style as the neighbours.

- [ ] **Step 2: Parity tests** — add a knowledge node → file has the fields, label assigned, placed right of/below the anchor; refresh marks the timestamp; `canvas_read` shows the text.

- [ ] **Step 3: typecheck + build + parity suite.**

- [ ] **Step 4: Commit** — `git commit -m "feat: MCP canvas_add_knowledge and canvas_refresh_knowledge"`

---

### Task 9: README, review, VSIX

- [ ] **Step 1: README** — a "Knowledge search" block: settings example (token in `settings.local.json`), `Ctrl+F` / `/`, the node header, refresh behaviour, the two MCP tools.
- [ ] **Step 2: Whole-feature review** (a read-only reviewer): spec §2–§9 line by line against the code; the fake-provider check (spec §10 last bullet): a provider with every capability false renders no filters and still adds/refreshes — write `test/knowledge-fake-provider.mjs` against the reducer + `outcomeOf` if the component cannot be tested headless.
- [ ] **Step 3: Version bump + `npm run package`**, smoke on a canvas with `skena.knowledge.servers = [crtx]`: `Ctrl+F` opens, `/` still finds in canvas, a search returns rows, preview loads, `Enter` adds a node right of the focused one, `↻` refreshes, reopening after editing `fetchedAt` in the file refreshes on open and the header shows `●` when the text changed, `↗` opens the reader.
- [ ] **Step 4: Commit the bump.**

---

## Self-review notes

- Spec coverage: §1 layers → Tasks 2–4; §2 interface → Task 1; §3 transport → Task 2; §4.1 crtx → Task 3; §4.2 Notion → not built (fake-provider check in Task 9); §5 config → Task 4; §6 node → Task 5; §7 dialog → Task 6; §8 refresh → Task 7; §9 MCP → Task 8; §10 tests → Tasks 1–3, 6, 7, 9; §11 → nothing built.
- Names used consistently: `KnowledgeProvider.fetch` (not `read`), `callTool`, `createCrtxProvider`, `createProvider`, `staleTargets`/`outcomeOf`/`takeNext`/`settle`/`drain`/`done`, message types as listed in Task 4.
- Known unknowns for the implementer to report: the exact `create_note`/`append_note` argument names (Task 3 Step 3); whether `fetch` is typed in the extension tsconfig (Task 2 Step 4); whether `toFlowNode` spreads unknown fields (Task 5 Step 2); whether text nodes auto-size on paste (Task 6 Step 3).
