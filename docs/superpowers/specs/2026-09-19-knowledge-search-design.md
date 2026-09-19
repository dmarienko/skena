# Knowledge search — design

Search a remote knowledge base from the canvas and put a result on it as a node that keeps a copy
of the text. The dialog and the node depend on one adapter interface; a server kind is one adapter
file. First adapter: crtx (`kb` MCP). Second, sketched here to check the shape: Notion.

Decisions taken with the user on 2026-09-19: crtx first; the node keeps a cached copy of the text
(works on any machine, any server); knowledge search has its own key, `Ctrl+F` stays
find-in-canvas; `Enter` adds one result and closes; refresh on open for stale nodes plus a manual
refresh, with a mark when the text changed; an adapter layer so other servers attach without
touching the dialog or the node.

## 1. Layers

```
webview   KnowledgeSearch dialog ── KnowledgeNode
              │ messages (search / fetch / scopes / facets / refresh)
host      KnowledgeService  — one KnowledgeProvider per configured server
              │
adapters  crtxProvider   notionProvider (later)   …one file per kind
              │
transport McpHttpClient (streamable HTTP JSON-RPC)   McpStdioClient (later, if a kind needs it)
```

The dialog and the node never see a tool name, a vault, a page id or a URL scheme. They see
`KnowledgeProvider`, `KnowledgeHit`, `KnowledgeText` and an opaque `uri` string.

## 2. The adapter interface

`src/shared/knowledge/types.ts`:

```ts
interface KnowledgeQuery { text: string; scope?: string; tags?: string[]; recency?: boolean; top: number }

interface KnowledgeHit {
  server:   string;      // - the configured server name, e.g. "crtx" or "notion-work"
  uri:      string;      // - opaque to the dialog and the node; the adapter builds and reads it
  title:    string;      // - e.g. "skena.md › 2026-09-19 — state" or a Notion page title
  subtitle?: string;     // - e.g. the vault, the database or the parent page
  date?:    string;
  tags:     string[];
  snippet:  string;      // - ≤ 200 chars, one line
}

interface KnowledgeText { uri: string; title: string; text: string; fetchedAt: string }

interface KnowledgeProvider {
  readonly name: string;                                   // - from config
  readonly kind: string;                                   // - adapter id: "crtx", "notion", …
  readonly capabilities: { scopes: boolean; tags: boolean; recency: boolean; facets: boolean };
  search(q: KnowledgeQuery): Promise<KnowledgeHit[]>;
  fetch(uri: string): Promise<KnowledgeText>;              // - the text a node caches; used by add and refresh
  scopes(): Promise<string[]>;                             // - vaults / workspaces / databases; [] when unsupported
  facets(scope?: string): Promise<{ tags: [string, number][] }>;  // - {tags: []} when unsupported
  openUrl(uri: string): string | undefined;                // - a browser URL for the header's open button
}
```

Rules:
- Every method returns; errors come back as a rejected promise with a plain message, and
  `KnowledgeService` turns them into `{ error }` for the webview. No adapter throws into the UI.
- `capabilities` decides which dialog controls appear: no `scopes` → no scope selector; no `tags` →
  `#tag` tokens stay in the query text; no `facets` → tags are not validated.
- `uri` is stable across restarts and machines; it is the node's identity for refresh.

Adding a server kind = one file `src/extension/knowledge/adapters/<kind>.ts` exporting
`createProvider(config, transport): KnowledgeProvider`, plus one line in the adapter registry.

## 3. Transport

`src/extension/knowledge/mcpHttpClient.ts` — streamable HTTP JSON-RPC 2.0:
- `initialize` once per process (protocol version, client name), then `callTool(name, args)`.
- `POST` with `Accept: application/json, text/event-stream`; a JSON body is read as is; an
  `event-stream` body is read until the message with the matching `id`. `Mcp-Session-Id` from a
  response is sent back on later calls.
- 5 s timeout per call. Headers from config (`Authorization: Bearer <token>`).
- Pure framing (request building, JSON/SSE response parsing) in
  `src/shared/knowledge/jsonrpc.ts`, unit-tested with recorded bodies.

An adapter receives a transport it did not create, so a stdio transport (for a local Notion MCP
server started as a process) is a second class with the same `callTool`, not an adapter change.

## 4. Adapters

### 4.1 crtx (`kind: "crtx"`) — v1

Server facts (measured 2026-09-19): streamable HTTP at `POST <url>`, bearer token, host
allow-list. Tools and the mapping:

| Provider method | Tool | Mapping |
|---|---|---|
| `search` | `search(query, vault?, tags?, recency?, top, full_text=false)` | hit → `{uri, title: "<file> › <heading>", subtitle: vault, date, tags, snippet}` |
| `fetch(uri)` | `read_section(vault, file, heading)` (`read(vault, file)` when the heading is empty) | `{uri, title, text, fetchedAt: now}` |
| `scopes` | `list_vaults` | names |
| `facets` | `facets(vault?)` | `tags` |
| `openUrl` | — | `http://<host>:8787/#<vault>/<url-encoded file>` |

`uri` = the server's own `crtx://<vault>/<file>#<heading>`; parse/build in
`src/shared/knowledge/crtxUri.ts`. Capabilities: all four true.

### 4.2 Notion (`kind: "notion"`) — later; on paper now

| Provider method | Tool (official remote MCP / self-hosted `notionApi`) | Mapping |
|---|---|---|
| `search` | `notion-search` / `API-post-search` | page → `{uri: "notion://<pageId>", title, subtitle: parent, date: last_edited_time, tags: [], snippet: first text block}` |
| `fetch(uri)` | `notion-fetch` / `API-get-block-children` | blocks → markdown |
| `scopes` | — | `[]` (capability off) |
| `facets` | — | off |
| `openUrl` | — | `https://notion.so/<pageId>` |

Two things the shape has to allow, and does: a hit without tags or scope, and a `fetch` that
assembles text from many blocks. Authentication for the official server is OAuth — that is a
transport concern (a token obtained once, then a bearer header), not an adapter one.

## 5. Configuration

```jsonc
// settings.json (shared) or .vscode/settings.local.json (personal; wins per key)
"skena.knowledge.servers": [
  { "name": "crtx",   "kind": "crtx",   "url": "http://aurora-1:8788/mcp", "token": "…" },
  { "name": "notion", "kind": "notion", "url": "https://mcp.notion.com/mcp", "token": "…" }
],
"skena.knowledge.refreshAfterHours": 24
```

- `name` is what the node stores; `kind` picks the adapter; the rest is the transport's.
- Tokens live in `settings.local.json` (git-ignored), read through the existing `settings.ts`
  merge (`settings.local.json` → `settings.json` → user config).
- No servers: the key opens the dialog with "no knowledge server configured
  (`skena.knowledge.servers`)". An unknown `kind`: that entry is listed as unavailable with the
  reason.

## 6. The node

`type: "knowledge"` in the canvas file — provider-neutral:

```jsonc
{ "id": "…", "type": "knowledge", "x": 0, "y": 0, "width": 700, "height": 300,
  "server": "crtx", "uri": "crtx://crtx/projects/skena.md#2026-09-19 — state",
  "title": "skena.md › 2026-09-19 — state",
  "text": "…markdown…", "fetchedAt": "2026-09-19T14:03:00Z", "changed": false }
```

Rendering (`src/webview/canvas/nodes/KnowledgeNode.tsx`):
- header: `<server> › <title> · 2h ago`; a dot before the title while `changed`; buttons: refresh,
  open (shown only when `openUrl` gave a URL — the host resolves it once and stores nothing).
- body: the cached `text` through the existing `MarkdownRenderer`, read-only.
- border colour: a new entry in `DEFAULT_NODE_BORDER_BY_TYPE`; `nodeBorderColor('knowledge', …)`.
- focus clears `changed`.
- a column member for the layout engine like a text node. Delete, move, resize, copy/paste,
  sections, spatial nav, `g` labels: nothing special.

## 7. The dialog

`src/webview/canvas/KnowledgeSearch.tsx`, opened by `Ctrl+Shift+F` (handled in the canvas keydown
like `Ctrl+Shift+H/L`; verified against VS Code's find-in-files in the first build — fallback
`Ctrl+;`). `Esc` closes. Top-centre of the pane like `CanvasSearch`, wider, preview on the right.

| Part | Behaviour |
|---|---|
| server | a selector when more than one server is configured; hidden with one |
| input | the query; `search` runs 300 ms after the last keystroke, `top: 20`; `#tag` tokens become `tags` when the provider has `tags` (validated against `facets` when it has `facets`; an unknown tag → "no such tag" in the status line) |
| filters row | scope: `all · <scopes()>` (`Tab` cycles) when the provider has `scopes`; recency toggle when it has `recency` |
| results | one row per hit: `title`, `subtitle`, `date`, `snippet`, tags; `↑/↓` move the highlight; server order kept |
| preview | `fetch(uri)` of the highlighted hit, rendered as markdown; requested 150 ms after the highlight settles; cached per uri for the dialog's life |
| `Enter` | adds the highlighted hit as a knowledge node (the preview's text if loaded, else fetched now) and closes; the node is focused and revealed |
| status line | server · hit count · "server unreachable" / the error text |

Placement of the new node: the paste rule — `directionSlot('L')` right of the focused node, the
engine makes room; pane centre when nothing is focused. 700 × 300, then the height of the rendered
text (the text-node rule). One history entry.

## 8. Refresh

- On canvas open, after the first paint: every knowledge node whose `fetchedAt` is older than
  `refreshAfterHours` is refreshed through its server's provider, one at a time, in file order. A
  server that does not answer stops the run for that server; the node header shows "not reachable"
  on hover, nothing else.
- Manual: the header button; the MCP tool `canvas_refresh_knowledge` (§9).
- Different text → `text`, `fetchedAt`, `changed: true`; same text → `fetchedAt` only; the adapter
  reports "gone" (a heading or page no longer exists) → old text kept, `error` shown in the header.

## 9. MCP parity

The skena MCP server is a separate process without the servers' tokens, so it does not call them.
v1 adds `canvas_add_knowledge {server, uri, title, text}` (writes the node, `fetchedAt = now`) and
`canvas_refresh_knowledge {ref}` (marks the node; the host refreshes it when the webview is live or
on the next open). An agent that wants fresh text calls the knowledge server itself and passes it.

## 10. Tests

- `test/knowledge-jsonrpc.mjs`: request framing, JSON and SSE parsing, session id round-trip,
  timeout → error.
- `test/knowledge-crtx.mjs`: the crtx mapping over recorded tool results (search hit → `KnowledgeHit`,
  `read_section` → `KnowledgeText`, uri parse/build, `openUrl` encoding), with a fake transport.
- `test/knowledge-refresh.mjs`: the stale filter and the changed / same / gone outcomes as pure
  functions over a node and a result.
- Dialog keyboard behaviour as a pure reducer (`highlight`, `Tab`, `Enter`, `Esc`) if the component
  is split that way; otherwise a smoke in the first VSIX.
- A fake provider (`test/helpers/fakeProvider.mjs`) with all capabilities off, to check the dialog
  renders no scope/tags controls and the node still adds and refreshes — the Notion shape without
  Notion.

## 11. Not in v1

- The Notion adapter itself (§4.2 is the check that the interface fits it), OAuth.
- `related` / `neighbourhood` views on the canvas (a "what links here" action on a knowledge node
  is the natural next step; it would be a provider capability).
- Writing back (`create_note`, `append_note`).
- Section anchors inside a file for the local `vault://` file node.
