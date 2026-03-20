# Skena - Visual Research Canvas for VS Code

> A VS Code extension that renders [JSON Canvas](https://jsoncanvas.org/) (`.canvas`) files as interactive node graphs with rich content previews, connected to a markdown knowledge vault. Your research, code, and ideas - on one stage.

## Problem

Quantitative research generates a web of interconnected artifacts - strategies, indicators, backtest results, notebooks, code modules. Existing tools force you to choose between:

- **Notion/databases** — structured but slow, disconnected from code, hard to visualize relationships
- **Obsidian** — great visual canvas, but requires a desktop app (unusable on headless remote servers where actual research happens)
- **Plain markdown files** — fast, git-friendly, Claude-accessible, but no visual overview

Skena brings the spatial canvas experience into VS Code, reading the same `.canvas` format Obsidian uses, backed by a vault of `.md` files with YAML frontmatter.

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

**Skena extension node types** — `cell`, `chat`, `portal` (see Phase 5 & 6 for full spec).
These are extensions to the JSON Canvas spec. Obsidian silently ignores unknown node types, so `.canvas` files remain fully interoperable.

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
// Canvas loaded or reloaded from disk
{ type: 'canvasLoaded', canvas: CanvasData }

// File content response (for file node rendering)
{ type: 'fileContent', requestId: string, path: string, content: string, fileType: FileType }

// File content error (file not found, access denied, etc.)
{ type: 'fileError', requestId: string, path: string, error: string }

// Vault index ready / updated (for fuzzy search)
{ type: 'vaultIndex', entries: VaultEntry[] }

// Notion page content response
{ type: 'notionContent', requestId: string, pageId: string, markdown: string, meta: NotionMeta }

// File changed on disk — re-render this node
{ type: 'fileChanged', path: string }

// Canvas file changed externally (Obsidian edit) — reload
{ type: 'canvasChanged' }

// Agent chat response chunk (streaming)
{ type: 'chatChunk', nodeId: string, delta: string, done: boolean }

// Agent created a new node (from chat)
{ type: 'agentNodeCreated', chatNodeId: string, newNode: CanvasNode }
```

### Webview → Host

```typescript
// Request file content for rendering a node
{ type: 'requestFile', requestId: string, path: string }

// Request Notion page content
{ type: 'requestNotion', requestId: string, pageId: string }

// Save canvas after user edit (drag, resize, new node, delete)
{ type: 'saveCanvas', canvas: CanvasData }

// Open a file in VS Code editor tab
{ type: 'openFile', path: string }

// Fuzzy search query
{ type: 'searchVault', query: string, requestId: string }

// Search results request resolved
{ type: 'searchResults', requestId: string, results: VaultEntry[] }

// Send message to AI agent in a chat node
{ type: 'chatMessage', nodeId: string, message: string, canvasContext: CanvasContext }

// Request vault index refresh
{ type: 'refreshVault' }
```

### Key design rules

- Every request/response pair shares a `requestId` (UUID) for correlation — the webview can have multiple nodes loading in parallel
- `saveCanvas` is debounced 500ms in the webview before sending (not the host)
- File content is sent as raw string; the webview owns rendering (no HTML from host)
- Large files (> 500KB): host sends `{ type: 'fileError', error: 'TOO_LARGE' }` → webview shows a truncated preview indicator

---

## Extension Features

### Phase 1: Canvas Viewer (MVP)

**Command**: `Skena: Open Canvas` — opens `.canvas` file as React Flow webview

**Core principle**: File nodes must render **inline content previews** — not just metadata cards. This matches Obsidian canvas behavior where you see the actual document content, charts, and images inside each node on the canvas. The canvas should feel like a spatial document viewer, not a box-and-arrow diagram.

**Canvas rendering**:
- Parse JSON Canvas → map to React Flow nodes and edges
- Node dimensions come from the `.canvas` JSON (`width`, `height`) — user controls size by resizing

**File node rendering by type**:

- **Notion pages** (`vault://notion/<page-id>`):
  - Fetched via **Notion MCP server** (extension talks to running MCP, no token in settings)
  - Rendered as markdown using the same `MarkdownRenderer`
  - Thin header bar: Notion icon + page title + last edited date
  - Read-only (no write-back to Notion)
  - At low zoom: title + icon only
  - Cached in memory per session; stale indicator shown if MCP unreachable

- **Markdown files** (`.md`):
  - Render full markdown content inside the node using a markdown renderer
  - Support: headings, bold/italic, tables, lists, code blocks, blockquotes
  - Render embedded images (relative paths resolved against vault/project root)
  - Frontmatter is NOT shown in the rendered content (parsed separately)
  - Thin header bar at top: status badge + type label + title (from frontmatter)
  - Scrollable content area when content exceeds node height
  - At low zoom levels: title + status badge only (no content preview)
  - At high zoom levels: full rendered content, readable

- **Jupyter Notebooks** (`.ipynb`):
  - Parse notebook JSON, render cells in order:
    - Markdown cells: rendered as markdown (same as above)
    - Code cells: rendered with syntax highlighting (Python)
    - Output cells: render text output and **base64-encoded images** (`image/png`, `image/svg+xml`)
    - Non-image outputs (plotly JSON, widgets): show placeholder `[interactive output]`
  - Thin header bar: notebook icon + filename + kernel name + cell count
  - Scrollable content area
  - At low zoom: title + kernel name only

- **Python files** (`.py`):
  - Render with syntax highlighting (like a code preview)
  - Thin header bar: code icon + module path
  - At low zoom: show filename + first docstring or class/function signatures

- **YAML/config files** (`.yaml`):
  - Render with syntax highlighting
  - Thin header bar: config icon + filename
  - when click on node - open VSCode editor (as modal panel)

- **Image files** (`.png`, `.jpg`, `.svg`):
  - Render the image directly, scaled to fit node dimensions
  - Used for standalone chart screenshots, diagrams, etc.

**Text node rendering**:
- Full markdown rendering (same renderer as .md files)
- Supports headings, lists, links, bold/italic, code
- Editable on double-click (switch to markdown editor)
- Colored border based on canvas `color` property

**Group node rendering**:
- Semi-transparent colored background container
- Label at top-left in bold
- Other nodes can be placed inside (visual containment only — no logical grouping in JSON Canvas)
- Optional background image support (`background` property)

**Link node rendering**:
- URL displayed with favicon (fetched async)
- If URL points to a known site (GitHub, Medium, TradingView), show site-specific icon
- Title extracted from URL metadata if available (Open Graph tags, cached)
- Click → opens URL in VSCode HTML browser

**Edge rendering**:
- Arrows between node connection points (fromSide/toSide from JSON Canvas)
- Optional label rendered at edge midpoint
- Color from canvas `color` property
- Arrow end markers (configurable: arrow, none)

**Zoom-adaptive rendering (LOD — Level of Detail)**:
This is critical for performance with large canvases:

| Zoom level | Node rendering |
|---|---|
| < 0.3 (very zoomed out) | Colored rectangle + title text only |
| 0.3 – 0.6 (overview) | Title + status badge only (no content) |
| 0.6 – 1.0 (reading) | Full markdown render, images at reduced resolution |
| > 1.0 (detail) | Full render, full resolution images, scrollable content |

**Canvas interaction**:
- Zoom / pan / minimap (React Flow built-in)
- Click node → highlight with glow border, show details in side tooltip
- Cmd+click file node → open referenced file in VS Code editor tab or 
- Double-click text node → switch to inline markdown editor
- Drag nodes → updates position in `.canvas` JSON (auto-save with debounce)
- Resize nodes → drag corner handles → updates width/height in `.canvas` JSON
- Select multiple nodes (shift+click or box select) → bulk move/delete

**File watching**:
- Watch `.canvas` file for external changes (Obsidian edits) → refresh graph
- Watch referenced `.md` / `.ipynb` files → re-render node content on change
- Debounced updates to avoid flicker during active editing

**VS Code integration**:
- Custom editor for `.canvas` files (registered via `customEditors` contribution point)
- Appears in editor tab like any file
- Can be split-viewed alongside code
- Respects VS Code theme (dark/light) for node rendering

### Phase 2: Fuzzy Search + Add Node

**Command**: `Skena: Add Node from Vaults` (keyboard shortcut: `Cmd+Shift+A` in canvas)

**Vault indexer**:
- On activation, scan configured vault path for all `.md` files
- Parse YAML frontmatter with `gray-matter`
- Build fuse.js index on: `title`, `id`, `tags[]`, `type`, file path
- Watch vault for changes with chokidar → incremental reindex

**Project indexer**:
- Scan current workspace for: `.ipynb`, `.py`, `.yaml`, `.md` files
- Index on filename + path + (for notebooks) cell content keywords
- Watch workspace for changes

**Search UX**:
- Trigger from canvas context menu or keyboard shortcut
- VS Code QuickPick input (native, fast) with fuzzy matching
- Results grouped: "Vault: Alpha" / "Vault: Knowledge" / "Project Files"
- Each result shows: icon + title + type badge + tags
- Select → creates new file node on canvas at center of viewport (or at right-click position)
- Writes node to `.canvas` JSON immediately

**Also**:
- `Skena: Quick Search Vault` — same fuzzy search but opens the file in editor (not canvas)

### Phase 3: CRUD Operations

**Create new entry** (from canvas context menu):
- "New Strategy" → prompts for title, type → creates `alpha/{slug}.md` with frontmatter template → adds node to canvas
- "New Knowledge Entry" → same for `knowledge/{slug}.md`
- "New Research Log" → prompts for strategy, type → creates `logs/{strategy}/{date}-{slug}.md` → adds node connected to strategy node
- "New Text Note" → adds inline text node to canvas

**Link nodes**:
- Drag from node handle to another node → creates edge in `.canvas` only
- Does NOT modify `links:` frontmatter in referenced `.md` files (canvas is the source of truth for connections)

**Edit from canvas**:
- Right-click file node → "Edit Status" → QuickPick with status options → updates frontmatter
- Right-click file node → "Edit Score" → same
- Right-click file node → "Add Tag" → input + existing tag suggestions

**Delete**:
- Select node + Delete key → removes from `.canvas` only (does NOT delete the `.md` file)
- Right-click → "Remove from canvas" (same)
- Right-click → "Delete file" → confirmation dialog → removes both node and file

### Phase 4: Notebook Integration

- `.ipynb` file nodes show: notebook name, kernel, cell count, last modified
- Expandable preview of markdown cells / output images (base64 PNG/SVG only)
- "Run notebook" action from canvas context menu
- Parse notebook outputs for key metrics (Sharpe, drawdown) to display on node

### Phase 5: AI Chat Nodes + Cell Nodes

**Chat node** — an agent conversation terminal embedded in the canvas:
- User types in the node; response streams in
- Agent receives the full canvas as context: all node titles, types, and content summaries
- Agent can produce artifacts: creates `.md` in vault/project and adds a new connected node to canvas
- Chat history saved as `.chat.json` alongside the `.canvas` file
- Multiple chat nodes per canvas (different agents / different topics)
- Backend configurable: `skena.chat.backend: "claude" | "ollama" | "openai"` (default: `"claude"`)

**Chat node config in canvas JSON** (Skena extension):
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

**Cell nodes** — standalone output cells for pasting results directly onto canvas:
- Content stored **inline in `.canvas` JSON** (Skena extension node type, no sidecar files)
- Formats: `markdown` (tables, text), `image` (base64 PNG/SVG), `html`
- Created via: paste from clipboard, "Add cell" context menu, or agent artifact output
- Editable in place (double-click)

**Cell node in canvas JSON**:
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

### Phase 6: Canvas Portals

**Behavior**:
- Select nodes → right-click → "Extract to new canvas"
  - Selected nodes are **moved** (removed from parent canvas) into a new `.canvas` file
  - A **Portal node** is placed at the bounding box position of the removed nodes
  - Edges that crossed the boundary become dangling — user resolves manually
- Click portal node → opens linked canvas in a new VS Code tab
- Portal renders a static minimap thumbnail of the linked canvas (refreshed on open)

**Portal node in canvas JSON** (Skena extension):
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

Enables hierarchical organization: top-level overview canvas with portals → per-strategy deep-dive canvases.

---

## Extension Configuration

```jsonc
// .vscode/settings.json
{
  // Named vaults — supports multiple. URI format: vault://<name>/path/to/file.md
  "skena.vaults": [
    { "name": "v1", "path": "~/vault" },
    { "name": "work", "path": "~/work-vault" }
  ],

  // Notion integration — vault://notion/<page-id> URIs
  // Resolved via a running Notion MCP server (no token stored in extension)
  "skena.notion": {
    "enabled": false,
    "mcpServerUrl": "http://localhost:3000"   // URL of the Notion MCP server
  },

  // Directories to scan in each vault (relative to vault root)
  "skena.vaultDirectories": ["alpha", "knowledge", "logs", "inbox"],

  // File patterns to index in workspace (for project files)
  "skena.workspacePatterns": ["**/*.ipynb", "**/*.py", "**/*.yaml", "**/*.md"],

  // Excluded patterns
  "skena.excludePatterns": ["**/node_modules/**", "**/.git/**", "**/__pycache__/**"],

  // Auto-save canvas changes (ms debounce)
  "skena.autoSaveDelay": 500,

  // Node appearance
  "skena.nodeWidth": 400,
  "skena.nodeHeight": 250,

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

| Component | Library | Purpose |
|---|---|---|
| Extension framework | VS Code Extension API | Custom editor, commands, settings |
| Canvas rendering | [React Flow](https://reactflow.dev/) v12 | Node graph with handles, edges, minimap |
| UI framework | React 18 | Webview components |
| Bundler | esbuild | Fast extension + webview bundling |
| Frontmatter parsing | [gray-matter](https://github.com/jonschlinkert/gray-matter) | YAML frontmatter from .md files |
| Markdown rendering | [react-markdown](https://github.com/remarkjs/react-markdown) + remark-gfm | Rich markdown inside nodes (tables, code, etc.) |
| Syntax highlighting | [Shiki](https://shiki.style/) or [Prism](https://prismjs.com/) | Code blocks in .md, .py files, notebook code cells |
| Notebook parsing | Custom (`.ipynb` is JSON) | Parse cells, extract outputs, decode base64 images |
| Image handling | Native `<img>` with blob URLs | Render embedded images from vault/project paths |
| Fuzzy search | [fuse.js](https://www.fusejs.io/) | Instant vault search |
| File watching | [chokidar](https://github.com/paulmillr/chokidar) | Vault + workspace file changes |
| Canvas format | JSON Canvas 1.0 spec | Read/write .canvas files |
| Styling | Tailwind CSS | Webview styling, VS Code theme integration |

## Project Structure

```
skena/
  package.json                    ← Extension manifest + contributes
  tsconfig.json
  esbuild.config.mjs             ← Build config for extension + webview
  src/
    extension/                    ← Extension host (Node.js only)
      extension.ts                ← Activation, commands, custom editor provider
      vault-indexer.ts            ← Scan vault, parse frontmatter, build fuse.js index
      canvas-io.ts                ← Read/write JSON Canvas files
      file-watcher.ts             ← chokidar watchers for vault + workspace
      file-resolver.ts            ← Resolve vault:// URIs + project-relative paths
      notebook-parser.ts          ← Parse .ipynb JSON, extract cells + base64 images (Node.js only)
      notion-client.ts            ← Fetch Notion pages, convert to markdown (vault://notion/...)
      chat-manager.ts             ← AI chat node state, agent calls, node creation from agent
      search.ts                   ← fuse.js search over vault + workspace index
      commands/
        add-node.ts               ← "Add from vault" command
        create-entry.ts           ← "New strategy/knowledge/log" commands
        edit-properties.ts        ← Status/score/tag editing
        extract-to-canvas.ts      ← Selection → new canvas + portal node
    webview/                      ← React app (runs in webview sandbox)
      App.tsx                     ← Root component
      canvas/
        CanvasView.tsx            ← React Flow setup + event handlers
        nodes/
          FileNode.tsx            ← Base file node (header bar + content area)
          TextNode.tsx            ← Inline text node (editable markdown)
          GroupNode.tsx           ← Group container component
          LinkNode.tsx            ← URL node component
          CellNode.tsx            ← Standalone output cell (table / chart / image)
          ChatNode.tsx            ← AI chat terminal node
          PortalNode.tsx          ← Link to another .canvas file (minimap preview)
        edges/
          LabeledEdge.tsx         ← Edge with label rendering
      renderers/                  ← Content renderers (webview side only)
        MarkdownRenderer.tsx      ← .md content → rendered HTML (react-markdown)
        NotebookRenderer.tsx      ← .ipynb → rendered cells (md + code + base64 outputs)
        CodeRenderer.tsx          ← .py / .yaml → syntax highlighted code (Shiki)
        ImageRenderer.tsx         ← .png/.jpg/.svg → scaled image display
        NotionRenderer.tsx        ← Notion markdown → rendered HTML
        LODWrapper.tsx            ← Zoom-adaptive level-of-detail wrapper
      components/
        StatusBadge.tsx           ← Colored status indicator
        TagPill.tsx               ← Small tag display
        ScoreIndicator.tsx        ← Score visualization
        NodeHeader.tsx            ← Thin top bar (icon + title + badges)
        NodeTooltip.tsx           ← Hover detail panel
        ScrollableContent.tsx     ← Scrollable container for node content
        ChatMessages.tsx          ← Chat message list + input for ChatNode
      hooks/
        useCanvasData.ts          ← Canvas state management
        useVaultIndex.ts          ← Vault search state
        useFileContent.ts         ← Request + cache file content via postMessage
        useZoomLevel.ts           ← Track zoom for LOD switching
        useChat.ts                ← Chat node message state + streaming
      styles/
        canvas.css                ← React Flow customizations
        nodes.css                 ← Node component styles
        markdown.css              ← Markdown rendering styles (dark/light theme)
        code.css                  ← Syntax highlighting theme
    shared/                       ← Types and constants only (no Node.js APIs)
      types.ts                    ← CanvasNode, VaultEntry, MessageProtocol types, etc.
      constants.ts                ← Colors, defaults, node type enum
```

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

# Debug in VS Code
# Press F5 → launches Extension Development Host as a second remote window
# (VS Code opens a new window, also connected to remote — this is normal)

# Package
npm run package      # creates .vsix on remote, install via "Install from VSIX..."
```

### Webview DevTools on remote

Chrome DevTools are not available directly. Use VS Code's built-in webview inspector:

```
Help → Toggle Developer Tools   (opens VS Code's own DevTools)
```

For webview-specific debugging, add `?vscode-resource` logging or use `console.log` in the webview — output appears in the **Webview Developer Tools** panel (not the main DevTools). Alternatively:

```
Ctrl+Shift+P → "Open Webview Developer Tools"
```

This works correctly over Remote SSH.

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
- **Foam interop**: Partial. Vault `.md` files work with Foam's graph view if wikilinks are used. Skena uses `id`-based linking in frontmatter rather than wikilinks, but both can coexist.
- **Claude Code / AIX MCP**: Full. All data is plain files — `.md` with frontmatter and `.canvas` as JSON. Claude Code can create entries, update frontmatter, add nodes to canvas, and create research logs by writing files directly.
- **Git**: Full. Everything is plain text, version-controlled, diffable.

---

## Migration from Notion

Phase 0 involves exporting existing Notion databases to vault `.md` files:

1. **Alpha DB** → `alpha/*.md` (one file per strategy with frontmatter mapping Notion properties)
2. **Quantitative Features Database** → `knowledge/*.md` (one file per entry)
3. **Research Log** → `logs/{strategy}/*.md` (grouped by strategy)
4. **Inbox** → `inbox/*.md` (unprocessed clippings)

A migration script (`scripts/notion-export.py`) will use the Notion API to export and convert entries. Alternatively, use Notion's built-in Markdown export + a frontmatter normalization script.

Existing Obsidian vault content (already exported) can be reorganized to match the schema above.

---

# Interesting links for Visual part / representation
- This type of connections and visual style for nodes would looks good - https://github.com/RodZill4/material-maker
- https://github.com/lout33/infinite_canvas_vscode/ - obsidian cnavas plugin for VS code

## License

MIT
