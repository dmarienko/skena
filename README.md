<p align="center">
  <img src="https://raw.githubusercontent.com/dmarienko/skena/main/icons/icon.png" width="128" alt="Skena" />
</p>

# Skena — Visual Research Canvas for VS Code

> Render [JSON Canvas](https://jsoncanvas.org/) (`.canvas`) files as interactive node graphs right inside VS Code. Preview markdown notes, notebooks, code, and charts side-by-side. Navigate with vim keys. Talk to an AI companion that sees your canvas and works on it with you — no API key needed. Works over Remote SSH. Obsidian-compatible.

---

## Screenshots

![Research canvas with notebook outputs and interconnected nodes](https://raw.githubusercontent.com/dmarienko/skena/main/docs/pics/screen1.png)

*A full research canvas — notebook charts, correlation matrices, backtest results, and code all on one spatial board.*

![Connected research artifacts](https://raw.githubusercontent.com/dmarienko/skena/main/docs/pics/screen2.png)

*Navigate your research by relationship, not by folder. Nodes auto-update when files change on disk.*

![Text node with findings connected to strategy entries](https://raw.githubusercontent.com/dmarienko/skena/main/docs/pics/screen3.png)

*Write notes alongside the artifacts they describe. Monaco editor with full vim bindings — `i`, `o`, `yy`, `dd`, `p` all work.*

![Charts and code connected in a graph](https://raw.githubusercontent.com/dmarienko/skena/main/docs/pics/screen4.png)

*Pin notebook cell outputs as standalone nodes. Drag, zoom, connect — then save and push to git.*

---

## Why Skena

Quantitative research (or any deep technical work) generates a web of interconnected files — notebooks, results, code, configs, notes. Most tools force a choice:

| Tool | Problem |
|---|---|
| Obsidian canvas | Requires a desktop app — unusable on headless remote servers |
| Notion | Disconnected from code, slow, no git |
| Plain markdown | No visual overview of relationships |

Skena brings the spatial canvas experience **into VS Code**, so it works wherever VS Code works — including over Remote SSH on headless servers.

It reads and writes the standard [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) format, so `.canvas` files are fully compatible with Obsidian.

---

## Features

### AI companion — chat that lives on your canvas
A floating chat overlay embedded in the canvas itself, not in a side panel. It sees what you see and acts on the canvas directly.

- **Canvas-aware context** — the companion receives the focused node's content, its 1-hop connections, and your current viewport: zoom level, on-screen node labels, and the verbatim text visible in the focused node.
- **Acts on the canvas** — it can add notes, read and update nodes through Skena's bundled MCP tools. New notes land next to the node you're focused on.
- **Three providers** (`skena.ai.provider`):

| Provider | What it is | API key |
|---|---|---|
| `harness` | Drives your local [Claude Code](https://claude.com/claude-code) CLI | **None** — uses your existing `/login` |
| `anthropic` | Anthropic API directly | `skena.ai.apiKey` |
| `openai-compat` | Ollama, LM Studio, Groq, OpenAI, any OpenAI-format endpoint | endpoint-dependent |

- **Harness mode** is the flagship: one persistent Claude Code process per canvas, streaming responses, full agent tool use (file reads, shell, MCP), session **resume** when you reopen a canvas, and an isolated profile (`~/.skena/cc-profile`) that keeps your global hooks out of the token bill. Permission mode, allowed tools, and reachable directories are all configurable.
- **Live tool feedback** — watch Claude Code work: tool calls (edits, shell, canvas ops) stream in as cards with running→done status, thinking blocks, and a live token/cost meter. The full timeline is saved with the canvas.
- **Per-canvas model** — click the chat title to pick the AI model for *this* canvas; the choice is saved in the `.canvas` file (portable), overriding the global `skena.ai.model`.
- **Chat UX** — Monaco input with vim bindings, markdown + math (KaTeX + Typst) rendering in responses, draggable/resizable panel with a draggable input/output splitter, per-canvas history persisted in a `.skena.json` sidecar, Reset (⟲) and Compact (⤵) controls.

| Key | Action |
|---|---|
| ``Alt+` `` | Collapse / expand the chat panel |
| `Alt+I` | Toggle focus between chat input and canvas |

### Paste anything
`Ctrl+V` on the canvas turns the clipboard into the right node: screenshots and notebook chart/table outputs become cell nodes, copied files become file nodes, URLs become link nodes, text becomes a text node — all connected to the focused node with an edge. `yy` then `Ctrl+V` still duplicates canvas nodes.

### Interactive plotly charts
Plotly figures render live in cell nodes — from notebook outputs (`go.Figure`), via the `Alt+P` pin, or by pasting `fig.to_json()` output onto the canvas. Pan, zoom, and hover work inside the node. (Jupyter `FigureWidget` outputs carry no offline figure data, so use `go.Figure` or paste the figure JSON.)

### Rich inline previews
- **Markdown** (`.md`) — rendered with frontmatter header bar, status badges, scrollable content.
  - **Math** — KaTeX (`$…$`, `$$…$$`) and **[Typst](https://typst.app)** (`%…%` inline, `%%…%%` block) compiled to SVG. `50%` and prose stay literal.
  - **Links** — clickable; file links open in VS Code, with line anchors: `[go](./m0.py#L42)` opens at line 42.
- **Jupyter Notebooks** (`.ipynb`) — code cells, markdown cells, chart outputs, base64 images
- **Python / YAML** — syntax-highlighted code preview via [Shiki](https://shiki.style/)
- **HTML** (`.html`) — rendered inside an isolated shadow root (its styles can't leak into the canvas)
- **Images** — scaled to fit the node

### Run code on a Jupyter kernel
Turn code nodes into a live notebook. Run **Skena: Add Kernel** to drop a kernel node (configure servers in `skena.jupyter.kernels` as `{name, hubUrl, token}`), connect a code node to it with an edge, and execute.

- **Run** — `Shift+Enter`, `Ctrl+Enter`, `Alt+R`, or `Alt+J` inside the editor, or the ▶ button in the node header (disabled until the cell is connected to a kernel). Running a cell first runs any unrun upstream cells it's wired to, in dependency order.
- **Live output** — stdout, `tqdm` progress bars, and a subset of `ipywidgets` stream into a connected output node as the cell runs.
- **Interrupt** — `Ctrl`/`Cmd+C` (with confirm), the ■ stop button, or right-click while a cell is running.
- **Restart / shutdown** from the kernel node — cell run-flags reset so they re-run cleanly against the fresh namespace.
- **Agent runs too** — the AI companion can execute cells over MCP and you see the same live output.

### Markdown theme
`skena.markdownTheme` themes rendered markdown in nodes **and** chat:
- `vscode` (default) — adapts to your active VS Code color theme.
- `factors` — a dark research-terminal theme: teal headings, grid-lined tables, bundled **IBM Plex** fonts, and syntax-colored code blocks. `skena.markdownMaxWidth` caps line length for a readable column.

### Vim spatial navigation
Navigate the canvas without touching the mouse:

| Key | Action |
|---|---|
| `h` / `j` / `k` / `l` | Move focus to nearest node in direction |
| `Enter` / `Ctrl+Enter` | Open focused file in editor (beside / maximized) |
| `Alt+X` then `h/j/k/l` | Add node from vault search, connected in direction |
| `Ctrl+Shift+H/J/K/L` or arrows | Add connected empty text node in direction and start editing it |
| `Space` | Pin node for group movement or edge connection |
| `Shift+H/J/K/L` | Move pinned nodes one grid step — or scroll focused node's content if nothing is pinned |
| `c` | Toggle edge between pinned node and focused node (connect / disconnect) |
| `yy` / `dd` / `p` | Copy / delete / paste nodes (canvas clipboard) |
| `u` / `r` | Undo / redo (50-entry canvas history) |
| `Ctrl+U` / `Ctrl+D` | Scroll focused node's content up / down (vim half-page) |
| `w` / `W` | Widen / narrow focused node |
| `e` / `E` | Expand / shrink focused node height |
| `z` / `Z` | Zoom in / out |
| `Shift+Alt+H/J/K/L` | Pan the viewport (vim scroll semantics) |
| `Shift+C` | Center viewport on focused node (zoom unchanged) |
| `Alt+Shift+C` | Center on focused node and zoom to readable scale |
| `m` `<key>` / `` ` `` `<key>` | Set / jump to mark (`Ctrl+M` opens the marks panel) |
| `Ctrl+N` | Add node via fuzzy vault search |
| `Ctrl+F` or `/` | Search within canvas |
| `Alt+P` | Pin hovered notebook cell output as a standalone node |
| `Ctrl+Shift+V` | Paste clipboard as a cell node |
| `Ctrl+V` | Paste clipboard as node — image/table → cell node, file → file node, URL → link node, text → text node; after `yy` pastes the copied nodes |
| ``Alt+` `` / `Alt+I` | AI chat: collapse/expand · focus toggle |

### Monaco text editor inside nodes
Double-click any text node to edit it inline — full Monaco editor with vim keybindings, markdown syntax highlighting, and VS Code theme integration.

### Vault integration
Point Skena at a folder of `.md` files (a vault). Use `Ctrl+N` to fuzzy-search and add any entry as a node. The vault is watched for changes — nodes update automatically.

### Canvas portals
Select nodes → right-click → **Move to sub-canvas** — selected nodes move to a new `.canvas` file and a portal node replaces them. Click the portal to open the linked canvas in a new tab.

### Zoom-adaptive rendering (LOD)
| Zoom | What you see |
|---|---|
| Very zoomed out | Colored rectangles + title only |
| Overview | Title + status badge |
| Reading distance | Full rendered content |
| Zoomed in | Full detail, scrollable |

### MCP server
On activation, Skena auto-deploys a local MCP server to `.vscode/skena-mcp.js` so Claude Code and other AI tools can read and write canvas nodes programmatically.

### VS Code Remote SSH compatible
All processing runs in the extension host on the remote machine. No local toolchain needed.

---

## Getting Started

1. **Install** the extension from the marketplace
2. Create or open any `.canvas` file — Skena opens it automatically as a visual canvas
3. *(Optional)* Configure your vault in `.vscode/settings.json`:

```jsonc
{
  "skena.vaults": [
    { "name": "v1", "path": "~/vault" }
  ],
  "skena.vaultDirectories": ["notes", "knowledge", "logs"]
}
```

4. Press `Ctrl+N` on the canvas to fuzzy-search your vault and add nodes
5. *(Optional)* Enable the AI companion — if you have [Claude Code](https://claude.com/claude-code) installed and logged in, this is all it takes (no API key):

```jsonc
{
  "skena.ai.provider": "harness"
}
```

Then press ``Alt+` `` on any canvas to open the chat.

---

## Configuration

```jsonc
{
  // Named vaults — supports multiple. URI: vault://<name>/path/to/file.md
  "skena.vaults": [
    { "name": "v1", "path": "~/vault" }
  ],

  // Directories to scan in each vault
  "skena.vaultDirectories": ["alpha", "knowledge", "logs", "inbox"],

  // Auto-save debounce (ms)
  "skena.autoSaveDelay": 500,

  // Rendered-markdown theme (nodes + chat)
  "skena.markdownTheme": "vscode",         // vscode | factors
  "skena.markdownMaxWidth": 0,             // max chars per line in md nodes (0 = unlimited; try ~88)

  // Show source cells alongside notebook outputs
  "skena.notebook": {
    "showSourceCells": false
  },

  // AI companion — pick a provider
  "skena.ai.provider": "harness",          // harness | anthropic | openai-compat
  "skena.ai.model": "sonnet",              // model id or CLI alias

  // harness provider (Claude Code CLI — no API key)
  "skena.ai.harnessPermissionMode": "acceptEdits",
  "skena.ai.harnessAllowedTools": ["Bash"],
  "skena.ai.harnessAddDirs": ["~/projects"],
  "skena.ai.harnessIsolate": true,         // isolated CC profile, no global hooks
  "skena.ai.session.restore": true,        // resume the canvas conversation on reopen

  // anthropic / openai-compat providers
  "skena.ai.apiKey": "",                   // or ANTHROPIC_API_KEY env var
  "skena.ai.baseURL": "http://localhost:11434/v1"  // e.g. Ollama
}
```

> **Multi-root workspaces**: `skena.*` settings are window-scoped — VS Code ignores them in folder-level `.vscode/settings.json` inside a multi-root workspace. Put them in the `settings` block of your `.code-workspace` file instead.

---

## Canvas Format

Skena reads and writes standard [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) — the same format used by Obsidian. Files are plain JSON, version-control friendly, and diffable.

**Supported node types**: `file`, `text`, `group`, `link`, `cell` (standalone output), `chat` (AI terminal, UI only), `portal` (link to another canvas)

Extension node types (`cell`, `chat`, `portal`) are silently ignored by Obsidian, so files remain fully interoperable.

---

## Obsidian Compatibility

`.canvas` files created in Skena open correctly in Obsidian and vice versa. Vault `.md` files use standard YAML frontmatter — readable by Obsidian, Foam, and any markdown tool.

---

## License

MIT — [github.com/dmarienko/skena](https://github.com/dmarienko/skena)
