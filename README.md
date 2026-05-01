# Skena - Visual Research Canvas for VS Code

> A VS Code extension that renders [JSON Canvas](https://jsoncanvas.org/) (`.canvas`) files as interactive node graphs with rich content previews, connected to a markdown knowledge vault. Your research, code, and ideas - on one stage.

## Problem

Quantitative research generates a web of interconnected artifacts - strategies, indicators, backtest results, notebooks, code modules. Existing tools force you to choose between:

- **Notion/databases** — structured but slow, disconnected from code, hard to visualize relationships
- **Obsidian** — great visual canvas, but requires a desktop app (unusable on headless remote servers where actual research happens)
- **Plain markdown files** — fast, git-friendly, Claude-accessible, but no visual overview

Skena brings the spatial canvas experience into VS Code, reading the same `.canvas` format Obsidian uses, backed by a vault of `.md` files with YAML frontmatter.

---

## Implementation Status

| Phase | Status | Description |
|---|---|---|
| Phase 1 — Canvas viewer | ✅ **Done** | Full node graph rendering, vim spatial nav, Monaco editor |
| Phase 2 — Vault search + add node | 🔶 **Partial** | `Ctrl+N` → add node works; `vault://` file rendering needs end-to-end test |
| Phase 3 — CRUD operations | ⬜ Planned | Create/edit/delete entries from canvas |
| Phase 4 — Notebook integration | ⬜ Planned | Run notebooks, parse outputs |
| Phase 5 — AI Chat + Cell nodes | ✅ **Implemented** (rendering only) | Chat and Cell node types render; no AI backend yet |
| Phase 6 — Canvas portals | ✅ **Implemented** | Portal nodes open linked `.canvas` in new tab |

---

## Architecture

```
~/vault/                              ← Shared Obsidian vault (git-synced)
  alpha/                              ← Strategy entries
    storm.md
    gemini.md
  knowledge/                          ← Features / indicators / concepts
    kalman-atr.md
    squeeze-momentum.md
    supertrend-fdi.md
  logs/                               ← Research results / reports
    storm/
      2025-09-21-v0-backtest.md
      2025-12-15-paper-trading.md
  inbox/                              ← Clipped items to review

~/projects/xforge/                    ← Research project
  src/xcap/models/storm/m0.py
  research/storm/
    trading/
      1.0 Storm experiments.ipynb
    storm-research.canvas             ← Canvas lives WITH the code
  configs/storm/storm.v0.yaml
```

**Key principle**: The vault is the knowledge layer (shared across projects). Canvas files live in project directories alongside code. The extension bridges both.

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│  VS Code Extension                                   │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Webview Panel (React + React Flow)             │ │
│  │  - Renders .canvas as interactive graph         │ │
│  │  - Custom node components per type              │ │
│  │  - Drag, zoom, pan, connect                     │ │
│  │  - Context menus for CRUD                       │ │
│  └────────────────────┬────────────────────────────┘ │
│                       │ message passing              │
│  ┌────────────────────▼────────────────────────────┐ │
│  │  Extension Host (Node.js)                       │ │
│  │  - Vault indexer (scans .md frontmatter)        │ │
│  │  - Fuzzy search (fuse.js)                       │ │
│  │  - Canvas file read/write (JSON Canvas spec)    │ │
│  │  - File watcher (chokidar)                      │ │
│  │  - Frontmatter parser (gray-matter)             │ │
│  └────────────────────┬────────────────────────────┘ │
│                       │ filesystem                   │
│         ┌─────────────┴──────────────┐               │
│    ~/vault/ (.md)          project/ (.canvas,        │
│                             .ipynb, .py, .yaml)      │
└──────────────────────────────────────────────────────┘
```

### How other tools access the same data

| Tool | Access method |
|---|---|
| **VS Code + Skena** | Direct filesystem — React Flow canvas |
| **Obsidian app** | Native — standard vault + JSON Canvas (Skena-specific node types silently ignored) |
| **Claude Code / AIX MCP** | Reads/writes `.md` + `.canvas` files directly |
| **Claude.ai** | Via Obsidian MCP server |
| **Notion** | Via Notion API — `vault://notion/<page-id>` nodes (read-only render) |
| **Remote headless server** | Same files via git sync or shared mount |

---

## Vault Schema

### Strategy entry (`alpha/*.md`)

```yaml
---
id: storm
title: "STORM - SuperTrend Optimized Range Momentum"
type: momentum
status: in-progress    # idea | research | backtest | paper | live | paused | dead
tags: [i.supertrend, i.atr, trend-following]
score: null            # null | bad | not-sure | interesting | promising | perfect
market: [crypto]
instruments: [SOLUSDT, ETHUSDT]
timeframe: 15Min
project: xforge        # links to project directory
links: [gemini, kalman-atr, squeeze-momentum]
created: 2025-09-21
updated: 2026-02-12
---

## Overview
STORM (SuperTrend Optimized Range Momentum) — trend-following strategy based on 
ATR-adaptive SuperTrend indicator...

## Implementation
- **V0** (pandas): `src/xcap/models/storm/m0.py`
- **V1** (streaming): `src/xcap/models/storm/m1.py`

## Parameters
| Parameter | Default | Description |
|---|---|---|
| atr_period | 24 | ATR lookback |
| atr_multiplier | 3.0 | SuperTrend band width |

## Latest Results
- storm.v0: Sharpe -0.85, MaxDD 55.4% (2021-2026, full cycle)
- Recent trending period (Jun-Sep 2025): Sharpe 2.73

## Next Steps
- Test longer timeframes (1h, 4h)
- Kalman ATR replacement
- Regime filter
```

### Knowledge entry (`knowledge/*.md`)

```yaml
---
id: kalman-atr
title: "Kalman Adjusted Average True Range"
type: indicator         # indicator | method | concept | model | reference
tags: [i.atr, i.kalmanfilter, volatility]
score: promising
market: [any]
url: https://example.com/article
created: 2025-08-31
---

## Summary
Uses Kalman filter to smooth ATR, producing less noisy trend lines...

## Notes
Tested as replacement for raw ATR in SuperTrend — reduces whipsaws.
```

### Research log entry (`logs/{strategy}/*.md`)

```yaml
---
id: storm-v0-backtest-20250921
strategy: storm
type: backtest          # backtest | experiment | observation | paper-trade | live-report
date: 2025-09-21
tags: [qubx, binance]
---

## storm.v0 backtest results

| Metric | Value |
|---|---|
| Gain | -$4,599 |
| Sharpe | -0.85 |
| MaxDD | 55.4% |
| Fees | $9,020 |

**Note**: Uses 0.5x VIP0 fees. Real fees would double the drag.
**Instruments**: SOLUSDT, ETHUSDT (Binance USDT-M futures)
**Period**: 2021-01-01 to 2025-09-21
```

### Controlled vocabularies

**`type` (strategy)**: `momentum`, `mean-revert`, `stat-arb`, `portfolio`, `microstructure`, `seasonality`, `dips-buying`, `defi`, `infrastructure`

**`type` (knowledge)**: `indicator`, `method`, `concept`, `model`, `pattern`, `reference`, `dataset`

**`status`**: `idea` → `research` → `backtest` → `paper` → `live` → `paused` | `dead`

**`score`**: `null`, `bad`, `not-sure`, `interesting`, `promising`, `perfect`

**`tags`**: Use dot-notation prefix convention:
  - `i.*` for indicators: `i.atr`, `i.supertrend`, `i.rsi`, `i.kalmanfilter`
  - `m.*` for methods: `m.kalman`, `m.hmm`, `m.pca`
  - No prefix for concepts: `trend-following`, `momentum`, `volatility`, `regime`

---

## Canvas Format

Skena reads and writes standard [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) files. No proprietary extensions — full Obsidian interop.

### Node types used

**File nodes** — reference vault entries or project files:
```json
{
  "id": "a1b2c3d4e5f67890",
  "type": "file",
  "file": "alpha/storm.md",
  "x": 100, "y": 200,
  "width": 400, "height": 300,
  "color": "4"
}
```

**Path resolution — URI scheme:**

Skena uses an explicit URI scheme to avoid ambiguity:

- **Vault files**: `vault://<vault-name>/path/to/file.md`
  - Example: `vault://v1/alpha/storm.md`, `vault://work/knowledge/kalman-atr.md`
  - Resolved against the matching entry in `skena.vaults[]`
- **Notion pages**: `vault://notion/<page-id>`
  - Fetched via Notion API, rendered as read-only markdown node
- **Project files**: relative path from the `.canvas` file location
  - Example: `../models/storm/m0.py`, `../../configs/storm/storm.v0.yaml`
- **Absolute paths**: supported as fallback

The `file` field in JSON Canvas uses these URIs directly.

**Text nodes** — inline notes, TODOs, annotations:
```json
{
  "id": "b2c3d4e5f6789012",
  "type": "text",
  "text": "## Further Research\n- Test Kalman ATR\n- Add regime filter",
  "x": 600, "y": 200,
  "width": 300, "height": 150,
  "color": "4"
}
```

**Group nodes** — visual containers:
```json
{
  "id": "c3d4e5f678901234",
  "type": "group",
  "x": 50, "y": 150,
  "width": 900, "height": 600,
  "label": "Storm Strategy",
  "color": "4"
}
```

**Link nodes** — external URLs:
```json
{
  "id": "d4e5f6789012345a",
  "type": "link",
  "url": "https://medium.com/@article-about-supertrend",
  "x": 800, "y": 400,
  "width": 300, "height": 150
}
```

**Cell nodes** — standalone output cells (Skena extension):
```json
{
  "id": "f6789012345678cd",
  "type": "cell",
  "format": "markdown",
  "content": "| Metric | Value |\n|---|---|\n| Sharpe | 1.8 |\n| MaxDD | -12% |",
  "x": 900, "y": 300,
  "width": 350, "height": 200
}
```

**Chat nodes** — AI conversation terminal (Skena extension):
```json
{
  "id": "a7890123456789de",
  "type": "chat",
  "agent": "claude",
  "model": "claude-opus-4-5",
  "title": "Storm regime analysis",
  "x": 1100, "y": 200,
  "width": 400, "height": 500
}
```

**Portal nodes** — link to another `.canvas` file (Skena extension):
```json
{
  "id": "b8901234567890ef",
  "type": "portal",
  "canvas": "./sub-research.canvas",
  "label": "Storm sub-research",
  "x": 500, "y": 700,
  "width": 300, "height": 180
}
```

Skena extension node types (`cell`, `chat`, `portal`) are transparent to Obsidian — it silently ignores unknown node types, so `.canvas` files remain fully interoperable.

**Edges** — connections between nodes:
```json
{
  "id": "e5f67890123456ab",
  "fromNode": "a1b2c3d4e5f67890",
  "fromSide": "right",
  "toNode": "b2c3d4e5f6789012",
  "toSide": "left",
  "toEnd": "arrow",
  "label": "next steps"
}
```

---

## Message Protocol (Extension Host ↔ Webview)

All communication between the Node.js extension host and the React webview uses VS Code's `postMessage` API. Messages are typed via `shared/types.ts`.

### Host → Webview

```typescript
// Webview is ready — send initial canvas + config
{ type: 'canvasLoaded', canvas: CanvasData, canvasPath: string }

// File content response (for file node rendering)
{ type: 'fileContent', requestId: string, path: string, content: string,
  fileType: FileType, html?: string }

// File content error (file not found, access denied, too large, etc.)
{ type: 'fileError', requestId: string, path: string, error: string }

// Vault index ready / updated (for fuzzy search)
{ type: 'vaultIndex', entries: VaultEntry[] }

// File changed on disk — re-render affected nodes
{ type: 'fileChanged', uri: string }

// Clipboard content response (for vim p paste)
{ type: 'clipboardContent', text: string }

// Trigger add-node flow from VS Code command (Ctrl+N)
{ type: 'addNodeTrigger' }

// Trigger add text node in direction from VS Code command
{ type: 'addTextNodeTrigger', direction: 'H' | 'J' | 'K' | 'L' }

// Add node result from QuickPick (host resolved vault search)
{ type: 'addNodeResult', node: CanvasNode, edge?: CanvasEdge, autoEdit?: boolean }

// Sub-canvas extraction completed
{ type: 'subCanvasCreated', portalNode: CanvasNode, movedNodeIds: string[] }

// Nodes resolved from Explorer drag-and-drop
{ type: 'nodesFromDrop', nodes: CanvasNode[] }

// Forward VS Code markdown preview settings
{ type: 'markdownConfig', config: MarkdownConfig }

// Search results response
{ type: 'searchResults', requestId: string, results: VaultEntry[] }
```

### Webview → Host

```typescript
// Webview React app is mounted and ready to receive data
{ type: 'webviewReady' }

// Request file content for rendering a node
{ type: 'requestFile', requestId: string, uri: string, hint?: string }

// Save canvas after user edit (drag, resize, new node, delete, etc.)
{ type: 'saveCanvas', canvas: CanvasData }

// Open a file in VS Code editor tab
{ type: 'openFile', uri: string, modal?: boolean }

// Fuzzy search query against vault index
{ type: 'searchVault', query: string, requestId: string }

// Request add node from vault (opens QuickPick in host)
{ type: 'addNodeRequest', position: { x: number; y: number },
  fromNodeId?: string, fromSide?: NodeSide, toSide?: NodeSide }

// Request vault index refresh
{ type: 'refreshVault' }

// Write text to system clipboard (vim y/yy)
{ type: 'writeClipboard', text: string }

// Request current system clipboard text (vim p paste)
{ type: 'requestClipboardRead' }

// Copy absolute filesystem path of a file node
{ type: 'copyAbsolutePath', uri: string }

// Move selected nodes to a new sub-canvas + replace with portal
{ type: 'moveToSubCanvas', nodes: CanvasNode[], edges: CanvasEdge[],
  position: { x: number; y: number } }

// Files dropped from VS Code Explorer
{ type: 'dropFiles', uris: string[], position: { x: number; y: number } }

// Chat message to AI agent
{ type: 'chatMessage', nodeId: string, message: string }
```

### Key design rules

- Every request/response pair shares a `requestId` (UUID) for correlation — the webview can have multiple nodes loading in parallel
- `saveCanvas` is debounced 500 ms client-side before sending
- File content is sent as raw string or pre-rendered HTML; the webview owns display
- Large files (> `MAX_FILE_FULL_BYTES`): host sends truncated preview + `isTruncated: true`
- `clipboardContent` is also pushed proactively on `webviewReady` to warm the vim paste register

---

## Extension Features

### Phase 1: Canvas Viewer ✅

**Command**: `Skena: Open Canvas` — opens `.canvas` file as React Flow webview

**Core principle**: File nodes render **inline content previews** — not just metadata cards. The canvas feels like a spatial document viewer.

**Canvas rendering**:
- Parse JSON Canvas → map to React Flow nodes and edges
- Node dimensions come from the `.canvas` JSON (`width`, `height`)
- Empty `.canvas` files (newly created) open as a blank canvas without errors

**Node rendering by type**:

- **Markdown files** (`.md`): full markdown including frontmatter-parsed header bar (status badge + type + title), scrollable content, embedded images
- **Jupyter Notebooks** (`.ipynb`): cells in order — markdown rendered, code syntax-highlighted, base64 image outputs shown, interactive outputs show placeholder
- **Python / YAML files**: syntax-highlighted code preview
- **Image files**: scaled to fit node dimensions
- **Notion pages** (`vault://notion/<page-id>`): fetched via Notion MCP, rendered as markdown (planned)

**Text node editor**:
- Double-click (or `Enter` while focused) → Monaco editor with full vim keybindings
- Monaco theme (`skena-editor`) synced to VS Code theme via `--vscode-editor-background`
- Markdown syntax highlighting: headings (blue), bold (yellow/bold), italic (orange/italic), links (mint), blockquotes (green/italic), code fences (orange), code body (tan)
- Vim clipboard relay: `y`/`p` route through `vscode.env.clipboard` (webview sandbox workaround)
- Vim `o`/`O` (open line below/above): works correctly via patched `CMAdapter.commands.newlineAndIndent`
- `Ctrl/Cmd+Enter` or `Esc` (from normal mode) → commit and close editor

**Keyboard navigation (spatial mode — outside node editors)**:

| Key | Action |
|---|---|
| `h` / `j` / `k` / `l` or arrow keys | Navigate to nearest node in direction |
| `Enter` | Open focused file/link/portal node in VS Code editor |
| `Ctrl+Enter` | Open as modal (maximized editor group) |
| `Shift+H/J/K/L` | Add new text node connected in direction |
| `Ctrl+Shift+H/L` | Add new text node left/right (keyboard only path) |
| `Space` | Toggle space-pin on focused node (multi-select for movement) |
| `Shift+H/J/K/L` (with pinned nodes) | Move all space-pinned nodes by 8px grid step |
| `c` | Connect edge from space-pinned node to focused node |
| `Shift+C` | Remove all edges between pinned node and focused node |
| `c,c` (double-tap ≤400ms) | Copy absolute file path of focused file node |
| `yy` (double-tap ≤400ms) | Copy selected nodes to canvas clipboard |
| `dd` (double-tap ≤400ms) | Delete selected nodes + connected edges |
| `p` | Paste canvas clipboard (+40px offset, fresh IDs + labels) |
| `u` | Undo (canvas structure, 50-entry history) |
| `r` | Redo |
| `w` / `W` | Widen / narrow focused node by 10% (centre-anchored) |
| `e` / `E` | Expand / shrink focused node height by 10% |
| `z` / `Z` | Zoom in / out (viewport-centred, 15% step) |
| `Ctrl+N` | Add new node at viewport centre (QuickPick) |
| `Esc` | Clear space-pinned selection |
| `Ctrl+F` or `/` | Open canvas search bar |
| `Alt+P` | Pin hovered notebook cell output as CellNode |
| `Ctrl+Shift+V` | Paste clipboard as CellNode (auto-detects HTML vs markdown) |

**Canvas interactions**:
- Drag nodes → auto-saves with 500ms debounce
- Resize nodes → drag corner handles, grid-snapped (8px)
- Alignment guides during drag (snap to edges/centres of nearby nodes, threshold 16px)
- Box select + Shift+click for multi-select
- `Delete` key → delete selected nodes/edges
- Right-click → context menu (add text, add URL, search vault, copy, paste, move to sub-canvas)
- Double-click edge label → inline edit
- Drag from node handle → connect to another node or handle; drop on node body → auto-detects nearest side

**File watching**:
- Watch `.canvas` file for external changes (Obsidian edits) → reload
- Watch referenced `.md` / `.ipynb` files → re-render node content on change

**VS Code integration**:
- Custom editor for `.canvas` files
- `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo (canvas structure via `u`/`r` in spatial mode)
- MCP server auto-deployed to `.vscode/skena-mcp.js` + `.mcp.json` on activation

**Zoom-adaptive rendering (LOD)**:

| Zoom level | Node rendering |
|---|---|
| < 0.3 (very zoomed out) | Colored rectangle + title text only |
| 0.3 – 0.6 (overview) | Title + status badge only |
| 0.6 – 1.0 (reading) | Full markdown render, images |
| > 1.0 (detail) | Full render, full resolution, scrollable |

### Phase 2: Fuzzy Search + Add Node 🔶

**Command**: `Skena: Add Node from Vaults` — `Ctrl+N` in canvas

**Vault indexer**:
- Scans configured vault paths for `.md` files, parses YAML frontmatter with `gray-matter`
- Builds fuse.js index on: `title`, `id`, `tags[]`, `type`, file path
- Watches vault with chokidar → incremental reindex on change

**Search UX**:
- VS Code QuickPick with fuzzy matching, results grouped by vault
- Select → creates file node at viewport centre or right-click position
- Writes node to `.canvas` JSON immediately

**`skena.quickSearch`** — same fuzzy search but opens file in VS Code editor

**Still needed**: end-to-end `vault://` URI rendering test; `notion-client.ts` for `vault://notion/` URIs.

### Phase 3: CRUD Operations ⬜ (planned)

Create strategy/knowledge/log entries from canvas; edit frontmatter (status, score, tags) via right-click; delete file from canvas.

### Phase 4: Notebook Integration ⬜ (planned)

Run notebooks from canvas context menu; parse outputs for key metrics.

### Phase 5: Cell Nodes + Chat Nodes ✅ (rendering) / ⬜ (AI backend)

**Cell nodes** render inline (markdown/html/image), created via:
- `Alt+P` — pin hovered notebook output
- `Ctrl+Shift+V` — paste clipboard as cell

**Chat nodes** render as conversation UI; AI backend not yet wired.

### Phase 6: Canvas Portals ✅

Select nodes → right-click → "Move to sub-canvas" → selected nodes move to a new `.canvas` file; a **Portal node** replaces them. Click portal → opens linked canvas in new VS Code tab.

---

## Extension Configuration

```jsonc
// .vscode/settings.json (or settings.local.json — gitignored, for personal paths)
{
  // Named vaults — supports multiple. URI format: vault://<name>/path/to/file.md
  "skena.vaults": [
    { "name": "v1", "path": "~/vault" },
    { "name": "work", "path": "~/work-vault" }
  ],

  // Directories to scan in each vault (relative to vault root)
  "skena.vaultDirectories": ["alpha", "knowledge", "logs", "inbox"],

  // File patterns to index in workspace (for project files)
  "skena.workspacePatterns": ["**/*.ipynb", "**/*.py", "**/*.yaml", "**/*.md"],

  // Excluded patterns
  "skena.excludePatterns": ["**/node_modules/**", "**/.git/**", "**/__pycache__/**"],

  // Auto-save canvas changes (ms debounce)
  "skena.autoSaveDelay": 500,

  // Default node dimensions for newly created nodes
  "skena.nodeWidth": 400,
  "skena.nodeHeight": 250,

  // Notebook display options
  "skena.notebook": {
    "showSourceCells": false    // show code cells alongside outputs
  },

  // Color scheme (matches Obsidian canvas color codes 1-6)
  "skena.colors": {
    "1": "#fb464c",  // red
    "2": "#e9973f",  // orange
    "3": "#e0de71",  // yellow
    "4": "#44cf6e",  // green
    "5": "#53dfdd",  // cyan
    "6": "#a882ff"   // purple
  }
}
```

---

## Tech Stack

| Component | Library | Version | Purpose |
|---|---|---|---|
| Extension framework | VS Code Extension API | — | Custom editor, commands, settings |
| Canvas rendering | [React Flow](https://reactflow.dev/) | v12 | Node graph with handles, edges, minimap |
| UI framework | React | 18 | Webview components |
| Bundler | esbuild | — | Fast extension + webview bundling |
| Text node editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) | via `@monaco-editor/react` | Full code editor with markdown support |
| Vim keybindings | [monaco-vim](https://github.com/brijeshb42/monaco-vim) | 0.4.4 | Vim modal editing inside Monaco |
| Frontmatter parsing | [gray-matter](https://github.com/jonschlinkert/gray-matter) | — | YAML frontmatter from .md files |
| Markdown rendering | [react-markdown](https://github.com/remarkjs/react-markdown) + remark-gfm | — | Rich markdown inside nodes |
| Syntax highlighting (code) | [Shiki](https://shiki.style/) | — | Code blocks in .md, .py, notebook cells |
| Notebook parsing | Custom (`.ipynb` is JSON) | — | Parse cells, extract outputs, decode base64 |
| Fuzzy search | [fuse.js](https://www.fusejs.io/) | — | Instant vault search |
| File watching | [chokidar](https://github.com/paulmillr/chokidar) | — | Vault + workspace file changes |
| Canvas format | JSON Canvas 1.0 spec | — | Read/write .canvas files |
| Styling | Tailwind CSS | — | Webview styling, VS Code theme integration |

### Monaco / vim-mode notes

- **Theme**: `skena-editor` custom theme defined in `beforeMount`, reads `--vscode-editor-background` to match VS Code theme. Markdown token colours are set explicitly (Monaco's built-in `vs-dark`/`vs` themes have no dedicated markdown rules).
- **Clipboard**: `navigator.clipboard` is blocked in the webview sandbox. All vim y/p operations relay through `vscode.env.clipboard` via a custom relay register replacing `"`, `+`, `*` in the `RegisterController`.
- **`o`/`O` fix**: `CMAdapter.commands.newlineAndIndent` uses async `editor.trigger()` which doesn't fire during a vim key handler. Patched via `patchVimNewlineAndIndent()` to use synchronous `editor.executeEdits('\n')`.

---

## Project Structure

```
skena/
  package.json                    ← Extension manifest + contributes
  tsconfig.json
  esbuild.config.mjs              ← Build config for extension + webview
  src/
    extension/                    ← Extension host (Node.js only)
      extension.ts                ← Activation, commands, custom editor provider
      editor-provider.ts          ← SkenaEditorProvider + SkenaDocument
      vault-indexer.ts            ← Scan vault, parse frontmatter, build fuse.js index
      canvas-io.ts                ← Read/write JSON Canvas files (empty-file safe)
      file-watcher.ts             ← chokidar watchers for vault + workspace
      file-resolver.ts            ← Resolve vault:// URIs + project-relative paths
      notebook-parser.ts          ← Parse .ipynb JSON, extract cells + base64 images
      markdown-html.ts            ← Server-side markdown → HTML (for file nodes)
      settings.ts                 ← Read skena.vaults + settings.local.json merge
      mcp/
        server.ts                 ← MCP server (auto-deployed to .vscode/skena-mcp.js)
    webview/                      ← React app (runs in webview sandbox)
      App.tsx                     ← Root component + host message router
      canvas/
        CanvasView.tsx            ← React Flow setup, all keyboard handlers, save/undo
        CanvasSearch.tsx          ← In-canvas fuzzy search overlay
        ContextMenu.tsx           ← Right-click menu
        HelperLines.tsx           ← Alignment guide lines during drag
        nodes/
          FileNode.tsx            ← File node (header bar + content area + LOD)
          TextNode.tsx            ← Text node (Monaco editor + vim + clipboard relay)
          GroupNode.tsx           ← Group container component
          LinkNode.tsx            ← URL node component
          CellNode.tsx            ← Standalone output cell (table / chart / image)
          ChatNode.tsx            ← AI chat terminal node (UI only)
          PortalNode.tsx          ← Link to another .canvas file
        edges/
          LabeledEdge.tsx         ← Edge with inline-editable label
      renderers/
        MarkdownRenderer.tsx      ← .md content → react-markdown
        NotebookRenderer.tsx      ← .ipynb → rendered cells (md + code + outputs)
        CodeRenderer.tsx          ← .py / .yaml → Shiki syntax highlighting
        ImageRenderer.tsx         ← .png/.jpg/.svg → scaled image
      components/
        StatusBadge.tsx           ← Colored status indicator
        NodeLabelBadge.tsx        ← Short reference label (N1, M3…) top-left corner
        NodeHeader.tsx            ← Thin top bar (icon + title + badges)
        ScrollableContent.tsx     ← Scrollable container with zoom-aware scroll
      hooks/
        useCanvasData.ts          ← Canvas state (nodes/edges/vault) + reducer
        useFileContent.ts         ← Request + cache file content via postMessage
        useZoomLevel.ts           ← Track zoom level for LOD switching
      context/
        ZoomLevelContext.tsx      ← React context for zoom level (consumed by LOD)
        MarkdownConfigContext.tsx ← VS Code markdown preview settings forwarded from host
    shared/                       ← Types and constants only (no Node.js APIs)
      types.ts                    ← CanvasNode, VaultEntry, message protocol types
      constants.ts                ← Colors, file size limits, node type enum
      nodeLabels.ts               ← Reference label assignment logic (N1, M3…)
```

> **Planned but not yet created**: `notion-client.ts`, `chat-manager.ts`, `commands/create-entry.ts`, `commands/edit-properties.ts`, `commands/extract-to-canvas.ts`, `renderers/NotionRenderer.tsx`, `components/ChatMessages.tsx`, `hooks/useChat.ts`

---

## Development Setup

### Remote development (VS Code Remote SSH)

Skena is developed on a remote machine via VS Code Remote SSH. **Everything runs on the remote** — Node.js, npm, esbuild, the extension host, and the webview sandbox. No local toolchain needed.

```
Local machine          Remote machine
──────────────         ───────────────────────────────────────
VS Code UI      ──→    Extension host (Node.js) + Webview
                       ~/devs/skena/   (source)
                       ~/vault/        (vault files)
```

`extensionKind` in `package.json` must be `["workspace"]` (default for filesystem extensions) — this ensures VS Code runs the extension on the remote, not locally.

```bash
# Clone and install (on remote)
git clone https://github.com/dmarienko/skena.git
cd skena
npm install

# Development (watch mode — runs on remote)
npm run dev          # builds extension + webview, watches for changes

# Type check only (no emit)
npm run typecheck

# Debug in VS Code
# Press F5 → launches Extension Development Host as a second remote window

# Package
npm run package      # creates .vsix on remote, install via "Install from VSIX..."
```

### Webview DevTools on remote

```
Ctrl+Shift+P → "Open Webview Developer Tools"
```

Works correctly over Remote SSH.

### Webview resource URIs (important)

When serving local files (images, fonts) into the webview, **never use raw filesystem paths**. Convert them:

```typescript
// - in extension host, before sending path to webview
const uri = panel.webview.asWebviewUri(vscode.Uri.file('/home/quant0/vault/img.png'));
// - result: vscode-resource://... (works both local and remote)
```

This is critical for image rendering inside file nodes — raw `file://` paths are blocked by the webview sandbox.

---

## Compatibility

- **Obsidian interop**: Full. Canvas files created/edited in Skena open in Obsidian and vice versa. Vault `.md` files are standard Obsidian notes with YAML frontmatter.
- **Foam interop**: Partial. Vault `.md` files work with Foam's graph view if wikilinks are used.
- **Claude Code / AIX MCP**: Full. All data is plain files — `.md` with frontmatter and `.canvas` as JSON.
- **Git**: Full. Everything is plain text, version-controlled, diffable.

---

## Migration from Notion

Phase 0 involves exporting existing Notion databases to vault `.md` files:

1. **Alpha DB** → `alpha/*.md` (one file per strategy with frontmatter mapping Notion properties)
2. **Quantitative Features Database** → `knowledge/*.md` (one file per entry)
3. **Research Log** → `logs/{strategy}/*.md` (grouped by strategy)
4. **Inbox** → `inbox/*.md` (unprocessed clippings)

A migration script (`scripts/notion-export.py`) will use the Notion API to export and convert entries.

---

## Interesting links

- https://github.com/RodZill4/material-maker — node connection + visual style reference
- https://github.com/lout33/infinite_canvas_vscode/ — Obsidian canvas plugin for VS Code

## License

MIT
