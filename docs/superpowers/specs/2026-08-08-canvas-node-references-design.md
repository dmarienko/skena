# Canvas node references — design

**Date:** 2026-08-08
**Project:** Skena
**Status:** design, approved to spec

## Goal

Reference a specific node in another canvas by its label, from a diamond node or a
markdown link. Activating the reference opens the target canvas and focuses (selects +
centers) the referenced node.

Example reference string: `test/H1.canvas#N2`.

## Decisions (settled during brainstorming)

- **Resolve by label, not id.** `#N2` names the target node's `nodeLabel`. Labels are
  persisted per node and never reassigned to an existing node (`shared/nodeLabels.ts`), so a
  reference only breaks if the target node is deleted (or deleted-then-a-new-node reuses the
  freed label slot). Hand-writable — the user can type a reference directly.
- **No scheme, no id.** The reference is the plain string `<path>.canvas#<Label>`.
- **Display hint.** The diamond stores an optional `title` captured when the reference is
  created, for display only; the label drives resolution.

## Reference string format

```
<path-to-canvas>#<Label>
```

- `<path-to-canvas>` ends in `.canvas`. `<Label>` is a node label including its type prefix
  (`N2`, `E3`, `K1`, `C5`, …).
- **Path resolution order** (at activation, host side): relative to the referencing canvas's
  folder → relative to the workspace root → absolute. Copy emits a **workspace-relative** path.

## Components

### 1. Open-and-focus primitive (host)

Extend the existing `openFile` message handling in `editor-provider.ts`. When the uri matches
`*.canvas#<Label>`:

1. Split into `canvasPath` + `label`.
2. Resolve `canvasPath` (resolution order above). If it does not exist → warning
   `"<path> not found"`, stop.
3. Record `pendingFocus.set(resolvedCanvasPath, label)`.
4. Open the Skena custom editor for the canvas (the existing `.canvas` → Skena-editor path).
5. When that canvas's webview signals ready (`webviewReady`/`canvasLoaded`), the host reads
   `pendingFocus` for its path, resolves `label` → node id in that document, sends
   `{ type: 'focusNode', id }`, and clears the entry. If the canvas is already open, send
   immediately (look it up via `panelsByPath`).
6. If no node has that label → warning `"<Label> not found in <basename>"`, canvas still opens.

The webview handles `focusNode` by calling the existing `focusNodeById(id)` (selects, DOM-focuses,
`setCenter` pans to it). A `skena:focusNode` event already exists for the intra-canvas case.

### 2. The reference node — `noderef` (diamond)

New node type `noderef`.

- **Data:** `{ type: 'noderef', canvas: string, label: string, title?: string, x, y, width, height }`.
  `canvas` is the workspace-relative path; `label` is the target label; `title` is a display hint.
- **Render:** `NoderefNode.tsx` — a diamond (romb) shape. Content: `<basename> › <label>` (e.g.
  `H1 › N2`), with `title` shown smaller beneath when present. Distinct accent color.
- **Activate:** click OR `Enter` while focused → `postMessage({ type:'openFile', uri: `${canvas}#${label}` })`
  → the primitive above.
- **Label prefix:** add `noderef` to `nodeLabelPrefix` (proposed prefix `D` for diamond) and the
  node registry / renderer map.
- Handles on all four sides so it can be connected like any node.

### 3. Copy reference

Two triggers, both produce the same clipboard string `<workspace-rel-path>#<label>` for the
focused node, written via the host (`vscode.env.clipboard`):

- **Hotkey `c c`** (double-tap `c` within 400 ms) while the canvas is active and a node is
  focused. **Replaces** the current `c,c` = copy-absolute-path binding (`CanvasView.tsx:1809`).
  Works for ANY node (every node has a label), not just file nodes. Single `c`
  (connect/disconnect edge) is unchanged.
- **Context menu** item **"Copy node reference"** on a node.

Flow: webview sends `{ type: 'copyNodeReference', label }`; the host composes
`<workspace-rel path of the current document>#<label>`, writes it to the clipboard, and shows a
brief confirmation (`"Copied reference <label>"`).

### 4. Paste reference

Extend the existing `Ctrl+V` paste-as-node type detection (image → cell, url → link, file →
file, text → text). Add: if the clipboard text matches `^.*\.canvas#[A-Z]+\d+$`, create a
`noderef` diamond instead of a text node.

- The host (which relays the clipboard read) parses the string, resolves the target canvas +
  label → the target node's current `title`/content preview for the `title` hint, and returns a
  `noderef` node placed at the paste position. If the target can't be resolved, still create the
  node (label drives later activation) with an empty `title`.
- Manual and copied references both paste identically, since detection is by pattern.

### 5. Markdown links

A markdown link whose href is `*.canvas#<Label>` activates the primitive. Both renderers:

- `MarkdownRenderer.tsx` (ReactMarkdown) — the `a` onClick already posts
  `{ type:'openFile', uri: href }`; no change needed beyond the host handling `.canvas#`.
- `markdown-html.ts` (host-rendered HTML for text/file nodes) — links already route through the
  webview click handler that posts `openFile`; confirm `.canvas#` href passes through unaltered
  (no line-anchor rewriting that would strip the `#Label`).

Generated form when copying for markdown is out of scope for v1 (the plain `#label` link works;
the user writes the link text).

## Data model changes

- `shared/types.ts`: add `NoderefNode` interface + `'noderef'` to the node union; add
  `MsgCopyNodeReference { type:'copyNodeReference'; label:string }` and `MsgFocusNode
  { type:'focusNode'; id:string }` to the message unions.
- `shared/nodeLabels.ts`: add `case 'noderef': return 'D'` to `nodeLabelPrefix`.

## Files touched

- `src/shared/types.ts` — node type + messages.
- `src/shared/nodeLabels.ts` — label prefix.
- `src/extension/editor-provider.ts` — `openFile` `.canvas#` branch, `pendingFocus` map, focus on
  ready, `copyNodeReference` handler, paste-resolve branch, context-menu command wiring.
- `src/webview/canvas/nodes/NoderefNode.tsx` — new diamond node.
- node registry (nodeTypes map) + `nodeTitle`/summary handling for `noderef`.
- `src/webview/canvas/CanvasView.tsx` — repurpose `c,c` to `copyNodeReference`; `focusNode`
  message → `focusNodeById`; Enter-to-activate for a focused `noderef`; paste routing already
  host-driven.
- `src/webview/renderers/MarkdownRenderer.tsx` / `src/extension/markdown-html.ts` — ensure
  `.canvas#Label` hrefs pass through.
- `package.json` — context-menu command contribution.

## Edge cases

- **Target canvas missing** → warning, no open.
- **Label missing in target** (deleted) → open canvas, warning, no focus.
- **Reference to a node in the SAME canvas** → resolves in place (focus without a new tab).
- **Path with spaces / nested folders** → workspace-relative path handles it; resolution tries
  canvas-dir then workspace-root.
- **Paste of a look-alike string** (`foo.canvas#N2` in prose) → becomes a diamond; acceptable,
  the pattern is specific (`.canvas#<PREFIX><digits>`).

## Testing

- Unit: reference string parse/format (path + label split, round-trip); `nodeLabelPrefix` for
  `noderef`; path-resolution order with a fixture layout.
- Unit: paste detection regex accepts `a/b.canvas#N2`, `x.canvas#E10`; rejects `note about
  x.canvas` and `http://…`.
- Manual: copy via `c c` in canvas A → paste in canvas B → diamond shows `A › N2` → click opens
  A centered on N2; delete N2 → click warns; markdown link `[t](A.canvas#N2)` → same.

## Out of scope (v1)

- Storing/resolving by node id (chosen: label only).
- Live label/title refresh on every render (snapshot at paste).
- Auto-generating markdown-link form on copy.
- Back-references / bidirectional links.
- Multi-node references.
