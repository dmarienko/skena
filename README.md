# Skena — Visual Research Canvas for VS Code

> Render [JSON Canvas](https://jsoncanvas.org/) (`.canvas`) files as interactive node graphs right inside VS Code. Preview markdown notes, notebooks, code, and charts side-by-side. Navigate with vim keys. Works over Remote SSH. Obsidian-compatible.

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

### Rich inline previews
- **Markdown** (`.md`) — rendered with frontmatter header bar, status badges, scrollable content
- **Jupyter Notebooks** (`.ipynb`) — code cells, markdown cells, chart outputs, base64 images
- **Python / YAML** — syntax-highlighted code preview via [Shiki](https://shiki.style/)
- **Images** — scaled to fit the node

### Vim spatial navigation
Navigate the canvas without touching the mouse:

| Key | Action |
|---|---|
| `h` / `j` / `k` / `l` | Move focus to nearest node in direction |
| `Enter` | Open focused file in VS Code editor |
| `Shift+H/J/K/L` | Add new text node connected in direction |
| `Space` | Pin node for group movement or edge connection |
| `c` | Connect edge from pinned node to focused node |
| `yy` / `dd` / `p` | Copy / delete / paste nodes (canvas clipboard) |
| `u` / `r` | Undo / redo (50-entry canvas history) |
| `w` / `W` | Widen / narrow focused node |
| `e` / `E` | Expand / shrink focused node height |
| `z` / `Z` | Zoom in / out |
| `Ctrl+N` | Add node via fuzzy vault search |
| `Ctrl+F` or `/` | Search within canvas |
| `Alt+P` | Pin hovered notebook cell output as a standalone node |
| `Ctrl+Shift+V` | Paste clipboard as a cell node |

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

  // Default node dimensions for newly created nodes
  "skena.nodeWidth": 400,
  "skena.nodeHeight": 250,

  // Auto-save debounce (ms)
  "skena.autoSaveDelay": 500,

  // Show source cells alongside notebook outputs
  "skena.notebook": {
    "showSourceCells": false
  }
}
```

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
