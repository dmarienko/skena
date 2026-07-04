# Paste-to-Node — Design

**Date**: 2026-07-04
**Status**: approved (brainstormed with user)
**Feature**: pasting OS clipboard content (text / image / file / URL) onto the canvas creates a node with that content.

## Summary

A window-level DOM `paste` listener in the webview turns clipboard content into canvas nodes. The DOM paste event is used (not the host clipboard relay) because it is the only channel that carries images and file lists — `vscode.env.clipboard` is text-only. `Ctrl+V` becomes a smart paste that prefers OS-clipboard content when it is newer than the internal `yy` node clipboard.

## User-visible behavior

| Clipboard content | Result |
|---|---|
| Image (screenshot, copied image) | Text node containing `![](data:image/png;base64,...)` — renders inline via MarkdownRenderer |
| File(s) (`text/uri-list`, e.g. copy in VS Code Explorer / OS file manager) | File node per URI (same resolution as drag-and-drop `onDrop`) |
| Text equal to the `yy` snapshot | Internal node paste — existing `p` behavior |
| Single-line `http(s)://…` | Link node |
| Single-line `file://` URI or absolute/`~/` path that exists on disk | File node (host-verified); non-existent → text node |
| Any other text | Text node |

Placement: right of the keyboard-focused node via `findFreePosition`, arrow edge `right → left` from the focused node (same pattern as `addTextNodeInDirection('L')`). No focused node → viewport center, no edge. Multiple URIs → nodes stacked with the free-position search, each connected to the focused node.

## Trigger & guards

- `window.addEventListener('paste', …)` in `CanvasView` (same lifecycle as the keydown handler).
- Handler is inert when: a Monaco editor has focus (node edit or FloatingChat input), canvas search or marks panel is open, or the event target is an input/textarea/contenteditable.
- `p` keeps its current internal-clipboard-only behavior. `Ctrl+Shift+V` keeps cell-node paste.

## Smart dispatch (priority order)

1. `clipboardData.items` contains an image item → **image paste**.
2. `text/uri-list` present → **file node(s)**.
3. Plain text present:
   a. text === `yy` snapshot → **internal node paste** (delegate to existing paste logic).
   b. trimmed single-line `http(s)://` URL → **link node**.
   c. trimmed single-line `file://` URI or path starting with `/` or `~/` → `verifyPath` round-trip → **file node** if it exists, else **text node**.
   d. otherwise → **text node**.
4. Nothing usable in the event → fall back to internal node paste if non-empty, else no-op.

### yy snapshot

On `yy`, the webview stores the current OS clipboard text (already pushed by the host relay / requested via `requestClipboardRead`) in a ref. On paste, `clipboardData.getData('text/plain')` is compared against it. Equal → the user's most recent copy was the `yy`; different → the OS clipboard is newer. No clipboard timestamps exist; this comparison is the discriminator.

## Image handling (user decision: data-URI, not asset files)

- `FileReader.readAsDataURL` on the image blob → text node with `![](<data-uri>)`.
- Node size: default 400×300.
- Data-URI > 5 MB: still paste, show a one-line warning toast about canvas JSON size (accepted tradeoff — no asset files, no extra dirs, Obsidian-compatible since it's a plain text node).

## Host side (editor-provider)

One new message pair in `src/shared/types.ts`:

- `verifyPath { path: string, requestId: string }` (webview → host): expand `~`, resolve `file://`, check existence.
- `verifyPathResult { requestId, exists, resolvedPath }` (host → webview): `resolvedPath` in the same convention `onDrop` produces (workspace-relative / vault URI).

Everything else stays in the webview. `text/uri-list` entries reuse the existing `onDrop` URI-resolution path — extract it into a shared helper if it is currently inline.

## Data flow

```
paste event → guards → classifyClipboard(payload) → PasteAction
  → (verifyPath round-trip if needed)
  → build CanvasNode (+ edge if focused node)
  → dispatch skena:addNodeResult   // - existing path: insert, save, undo history, focus
```

`classifyClipboard` is a pure function (no DOM, no vscode): takes `{ hasImage, uriList, text, yySnapshot }`, returns a typed `PasteAction`. Lives beside the canvas code; unit-tested standalone.

## Error handling

- Image read failure (FileReader error) → warning toast, no node.
- `verifyPath` timeout (>2 s) → treat as non-existent, create text node.
- Empty clipboard → silent no-op.

## Testing

`test/paste-classify.mjs` (node, behavioral — same style as `test/heatmap-bfs.mjs`):
- image beats uri-list beats text (priority order)
- yy-snapshot match → internal; mismatch → content
- URL vs `file://` vs `~/` path vs multi-line text discrimination
- whitespace-trimmed URL still a link; multi-line text containing a URL → text node
- empty payload → fallback action

Manual smoke: paste screenshot, paste file copied from Explorer, paste URL, paste plain text, `yy` then Ctrl+V (internal), copy external text then Ctrl+V (content).

## Out of scope

- Asset-file image storage (rejected by user in favor of data-URI).
- Paste into a node in edit mode (Monaco owns it).
- HTML clipboard flavor conversion (rich text → markdown) — future.
