# Knowledge search — design

Search a remote knowledge base from the canvas and put a result on it as a node that keeps a copy
of the text. The dialog and the node depend on one adapter interface; a server kind is one adapter
file. First adapter: crtx (`kb` MCP). Second, sketched here to check the shape: Notion.

Decisions taken with the user on 2026-09-19: crtx first; the node keeps a cached copy of the text
(works on any machine, any server); `Ctrl+F` opens knowledge search, `/` stays find-in-canvas (`Ctrl+F` is taken
from find-in-canvas, which keeps `/`); `Enter` adds one result and closes; refresh on open for stale nodes plus a manual
refresh, with a mark when the text changed; an adapter layer so other servers attach without
touching the dialog or the node; refresh never blocks the canvas; the adapter interface already
carries a write direction (push a node, an output, a group or an AI result into the server) for a
later round.

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
  readonly capabilities: { scopes: boolean; tags: boolean; recency: boolean; facets: boolean; write: boolean; assets: boolean };
  search(q: KnowledgeQuery): Promise<KnowledgeHit[]>;
  fetch(uri: string, signal?: AbortSignal): Promise<KnowledgeText>;  // - the text a node caches; used by add and refresh; signal = the refresh run's cancel
  scopes(): Promise<string[]>;                             // - vaults / workspaces / databases; [] when unsupported
  facets(scope?: string): Promise<{ tags: [string, number][] }>;  // - {tags: []} when unsupported
  openUrl(uri: string): string | undefined;                // - a browser URL for the header's open button
  asset(uri: string): Promise<{ mime: string; bytes: Uint8Array }>;  // - an image the text refers to; rejects when !capabilities.assets
  // - write direction (designed now, no UI in v1): push canvas content into the server
  write(item: KnowledgeWrite): Promise<{ uri: string }>;    // - a new note / page; rejects when !capabilities.write
  append(uri: string, item: KnowledgeWrite): Promise<void>; // - add to an existing one
}

interface KnowledgeWrite {
  title:   string;
  text:    string;                                          // - markdown; images as data URIs or attachments later
  tags?:   string[];
  scope?:  string;                                          // - vault / database; adapter decides the default
  dest?:   string;                                          // - a folder / parent inside the scope; the crtx vault requires it
  source:  { canvas: string; nodeIds: string[]; kind: 'node' | 'output' | 'group' | 'ai' };
}
```

The write direction covers the later "push to knowledge" actions: a node, a code output, a group of
nodes or an AI reply becomes a note (`write`) or is added to one (`append`). The crtx server already
has `create_note` / `append_note`; Notion has page creation and block append. v1 ships the
interface and the crtx mapping behind `capabilities.write`; no key or menu item calls it yet.

Rules:
- Every method returns; errors come back as a rejected promise with a plain message, and
  `KnowledgeService` turns them into `{ error }` for the webview. No adapter throws into the UI.
- `capabilities` decides which dialog controls appear: no `scopes` → no scope selector; no `tags` →
  `#tag` tokens stay in the query text; no `facets` → tags are not validated; no `write` → the
  future push actions are hidden for that server.
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
| `write` | `create_note(vault, title, text, tags)` | returns the new note's uri |
| `append` | `append_note(vault, file, text)` | — |

`uri` = the server's own `crtx://<vault>/<file>#<heading>`; parse/build in
`src/shared/knowledge/crtxUri.ts`. Capabilities: all five true (`write` through `create_note` /
`append_note`; exact argument names to be read off the server's schema when the mapping is built).

### 4.2 Notion (`kind: "notion"`) — later; on paper now

| Provider method | Tool (official remote MCP / self-hosted `notionApi`) | Mapping |
|---|---|---|
| `search` | `notion-search` / `API-post-search` | page → `{uri: "notion://<pageId>", title, subtitle: parent, date: last_edited_time, tags: [], snippet: first text block}` |
| `fetch(uri)` | `notion-fetch` / `API-get-block-children` | blocks → markdown |
| `scopes` | — | `[]` (capability off) |
| `facets` | — | off |
| `openUrl` | — | `https://notion.so/<pageId>` |
| `write` / `append` | page create / block append | markdown → blocks |

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
  open (always shown; the host resolves the URL on the click, and a source with no web address
  shows a message instead).
- body: the cached `text` through the existing `MarkdownRenderer`, read-only.
- border colour: a new entry in `DEFAULT_NODE_BORDER_BY_TYPE`; `nodeBorderColor('knowledge', …)`.
- focus clears `changed`.
- a column member for the layout engine like a text node. Delete, move, resize, copy/paste,
  sections, spatial nav, `g` labels: nothing special.

### 6.1 Images in a section (decided 2026-09-23)

Notes reference images relatively (`../assets/x.svg`, `./images/y.jpg`). The adapter rewrites every
image reference in a fetched section to an absolute `uri` of its own scheme (`crtx://<vault>/<path>`
for crtx), so the cached text is stable in the file and the node can ask for the image by that uri.

`KnowledgeProvider.asset(uri): Promise<{ mime: string; bytes: Uint8Array }>` behind
`capabilities.assets`. crtx: `GET http://<host>:8787/api/asset?vault=…&file=…` with the same bearer
token (measured: 401 without, 200 with; only files under `assets/` are served).

Rendering: the node and the dialog preview render the markdown as before; every `<img>` whose `src`
is a knowledge uri is sent to the host as `knowledgeAsset {server, uri}`; the host answers
`knowledgeAssetResult {uri, dataUrl | error}`; the webview swaps the `src`. Cache: in memory in the
host (per session, bounded to ~50 MB, oldest out) and in the webview (per uri); nothing is written
into the canvas. A failed image stays a broken image with the error in its `title`.

## 7. The dialog

`src/webview/canvas/KnowledgeSearch.tsx`, opened by `Ctrl+F` (VS Code's find-in-files takes
`Ctrl+Shift+F`). `CanvasSearch` (find-in-canvas) keeps `/` and loses `Ctrl+F`; while the knowledge
dialog is open `Ctrl+F` re-focuses its input. `Esc` closes. Top-centre of the pane like `CanvasSearch`, wider, preview on the right.

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
  `refreshAfterHours` is refreshed through its server's provider. The run lives in the extension
  host, not in the webview: the host's network calls are asynchronous and never block the canvas;
  at most 3 calls in flight per server; results reach the webview as they arrive, batched every
  250 ms into one `knowledgeRefreshed {nodes: [{id, text?, fetchedAt, changed?, error?}]}` message,
  so a canvas with hundreds of references repaints a few nodes at a time and stays responsive.
  Closing the canvas cancels the run. A server that does not answer stops the run for that server;
  the node header shows "not reachable" on hover, nothing else.
- CPU-bound adapter work (a Notion adapter turning many blocks into markdown, a large file being
  split into sections) runs in a `worker_threads` pool in the host, never in the webview and never
  on the host's main loop for more than one item at a time. The crtx adapter needs none of this —
  its results are already markdown.
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
  `read_section` → `KnowledgeText`, uri parse/build, `openUrl` encoding, `write`/`append` argument
  shapes), with a fake transport.
- `test/knowledge-refresh.mjs` also covers the scheduler as a pure function: at most 3 in flight per
  server, batching window, cancel drops pending work.
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
- The push actions (a key or menu item that calls `write` / `append` for a node, an output, a
  group or an AI reply) — the interface and the crtx mapping ship, the UI does not.
- Section anchors inside a file for the local `vault://` file node.
