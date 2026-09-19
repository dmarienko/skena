# Knowledge search — design

Search a remote knowledge base from the canvas and put a result on it as a node that keeps a copy
of the text. First server: crtx (`kb` MCP). The node and the client are shaped so another MCP
server can be added later without changing the node.

Decisions taken with the user on 2026-09-19: crtx first; the node keeps a cached copy of the section
(works on any machine, any server); knowledge search has its own key, `Ctrl+F` stays find-in-canvas;
`Enter` adds one result and closes; refresh on open for stale nodes plus a manual refresh, with a mark
when the text changed.

## 1. What the crtx server offers (measured 2026-09-19)

Streamable HTTP, `POST <url>` (JSON-RPC 2.0), `Authorization: Bearer <token>`. A host outside the
server's allow-list is refused.

| Tool | In | Out |
|---|---|---|
| `list_vaults` | — | `[{name, path}]` |
| `search` | `query, vault?, tags?, recency?, top?, full_text?` | per hit `{vault, file, heading, date, tags, id, project, snippet, uri}`; `text` too unless `full_text=false` |
| `read_section` | `vault, file, heading` | the section's markdown; a missing heading fails and names the real ones |
| `facets` | `vault?` | `{tags: [[name, count]…], projects: [[name, count]…]}` |
| `related` | `query, top?` | flat rows with `snippet`, `deep_link` |

`uri` = `crtx://<vault>/<file>#<heading>`; `heading` may be empty. The web reader for a hit is
`http://<host>:8787/#<vault>/<url-encoded file>`.

## 2. Configuration

```jsonc
// settings.json (shared) or .vscode/settings.local.json (personal; wins per key)
"skena.knowledge.servers": [
  { "name": "crtx", "kind": "crtx", "url": "http://aurora-1:8788/mcp", "token": "…" }
],
"skena.knowledge.refreshAfterHours": 24
```

- `kind` selects the tool mapping. v1 knows `crtx` only; a second kind is a new mapping file, not
  a change to the node or the dialog.
- The token lives in `settings.local.json` (git-ignored). Read through the existing
  `settings.ts` merge (`settings.local.json` → `settings.json` → user config).
- No servers configured: the key opens the dialog with the message "no knowledge server configured
  (`skena.knowledge.servers`)".

## 3. Host: the MCP client

`src/extension/knowledge/mcpHttpClient.ts` — one class per server:

- `initialize` once per process (protocol version, client name), then `tools/call`.
- Streamable HTTP: `POST` with `Accept: application/json, text/event-stream`; a JSON body is read as
  is; an `event-stream` body is read until the message with the matching `id`. The
  `Mcp-Session-Id` response header, when present, is sent back on later calls.
- Timeouts: 5 s per call. Errors are returned as `{ error: string }`, never thrown into the webview.
- Pure framing (request building, response parsing, SSE splitting) in
  `src/shared/knowledge/jsonrpc.ts`, unit-tested with recorded bodies.

`src/extension/knowledge/crtxServer.ts` — the `crtx` mapping: `search(query, opts)`,
`readSection(uri)`, `listVaults()`, `facets(vault?)`, each turning the tool result into the shared
types below. `src/shared/knowledge/uri.ts` — `parseKnowledgeUri`, `buildKnowledgeUri`
(`crtx://vault/file#heading`), `readerUrl(uri, serverUrl)`.

Shared types (`src/shared/knowledge/types.ts`):

```ts
interface KnowledgeHit   { server: string; uri: string; vault: string; file: string; heading: string;
                           date?: string; tags: string[]; project?: string; snippet: string }
interface KnowledgeText  { uri: string; text: string; fetchedAt: string }
```

Webview ↔ host messages: `knowledgeSearch {server, query, vault?, tags?, recency?}` →
`knowledgeResults {hits | error}`; `knowledgeRead {server, uri}` → `knowledgeText {text | error}`;
`knowledgeVaults`/`knowledgeFacets` likewise; `knowledgeRefresh {nodeIds}` (host reads each node's
uri and answers per node).

## 4. The node

`type: "knowledge"` in the canvas file:

```jsonc
{ "id": "…", "type": "knowledge", "x": 0, "y": 0, "width": 700, "height": 300,
  "server": "crtx", "uri": "crtx://crtx/projects/skena.md#2026-09-19 — state",
  "title": "skena.md › 2026-09-19 — state",
  "text": "…markdown of the section…", "fetchedAt": "2026-09-19T14:03:00Z",
  "changed": false }
```

Rendering (`src/webview/canvas/nodes/KnowledgeNode.tsx`):

- header: `crtx › projects/skena.md › 2026-09-19 — state · 2h ago`; a dot before the title while
  `changed`; two header buttons: refresh, open in the web reader (`readerUrl`).
- body: the cached `text` through the existing markdown renderer (`MarkdownRenderer`), read-only.
- border colour: a new entry in `DEFAULT_NODE_BORDER_BY_TYPE`; `nodeBorderColor('knowledge', …)`.
- focus clears `changed` (written to the file like any node change).
- the node is a column member for the layout engine like a text node (not an output, not a kernel).
- delete, move, resize, copy/paste, sections, spatial nav, `g` labels: nothing special — it is a
  node with a `text` body.

Edges: none created automatically.

## 5. The dialog

`src/webview/canvas/KnowledgeSearch.tsx`, opened by `Ctrl+Shift+F` (handled in the canvas keydown
like `Ctrl+Shift+H/L`; to be verified against VS Code's find-in-files in the first build — fallback
`Ctrl+;`). `Esc` closes. Floats at the top-centre of the pane like `CanvasSearch`, wider, with a
preview pane on the right.

| Part | Behaviour |
|---|---|
| server | one selector when more than one server is configured; hidden with one |
| input | the query; `search` runs 300 ms after the last keystroke with `full_text=false`, `top: 20`; `#tag` tokens in the query become the `tags` filter (validated against `facets`; an unknown tag shows "no such tag" in the status line) |
| filters row | vault: `all · <names from list_vaults>` (`Tab` cycles); recency toggle |
| results | one row per hit: `file › heading`, `date`, `snippet`, tags; `↑/↓` move the highlight; the list keeps the server's order |
| preview | the highlighted hit's section via `read_section`, rendered as markdown; requested 150 ms after the highlight settles; cached per uri for the dialog's life |
| `Enter` | adds the highlighted hit as a knowledge node (text = the preview's section if already loaded, else fetched now) and closes; the new node is focused and revealed |
| status line | server name · hit count · "server unreachable" / the error text |

Placement of the new node: the paste rule — `directionSlot('L')` right of the focused node, the
engine makes room; pane centre when nothing is focused. Size 700 × 300, then the height of the
rendered text (the text node rule). One history entry.

## 6. Refresh

- On canvas open, after the first paint: every knowledge node whose `fetchedAt` is older than
  `refreshAfterHours` is refreshed, one at a time, in file order. A server that does not answer
  stops the run for that server; nothing is shown except the status in the node header
  ("not reachable" on hover).
- Manual: the header button; the MCP tool `canvas_refresh_knowledge` (see §7).
- A refresh that returns different text sets `text`, `fetchedAt`, `changed: true`; same text sets
  `fetchedAt` only. A missing heading (the note was restructured) keeps the old text and sets an
  `error` field shown in the header.

## 7. MCP parity

The skena MCP server is a separate process without the knowledge token, so it does not call the
knowledge server itself. v1 adds `canvas_add_knowledge {uri, text, title?, server?}` (writes the
node with the given text, `fetchedAt = now`) and `canvas_refresh_knowledge {ref}` (marks the node
for refresh: the host refreshes it on the next open or when the webview is live). An agent that
wants fresh text calls the `kb` server itself and passes the text.

## 8. Tests

- `test/knowledge-jsonrpc.mjs`: request framing, JSON and SSE response parsing, session id
  round-trip, timeout → error.
- `test/knowledge-uri.mjs`: parse/build round-trips, empty heading, url-encoded file in `readerUrl`.
- `test/knowledge-refresh.mjs`: the stale filter (`fetchedAt` vs hours), the changed/same/missing
  outcomes as pure functions over a node and a result.
- Dialog keyboard behaviour as a pure reducer (`highlight`, `Tab`, `Enter`, `Esc`) if the component
  is split that way; otherwise a smoke in the first VSIX.

## 9. Not in v1

- Notion or any second server kind (the mapping file is the extension point).
- `related` / `neighbourhood` views on the canvas (a "what links here" action on a knowledge node
  is the natural next step).
- Writing back to the vault (`create_note`, `append_note`).
- Section anchors inside a file for the local `vault://` file node.
