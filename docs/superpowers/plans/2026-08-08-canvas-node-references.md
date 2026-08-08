# Canvas Node References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reference a labelled node in another canvas from a diamond node or a markdown link; activating it opens that canvas and focuses the node.

**Architecture:** A browser-safe pure module (`shared/nodeRef.ts`) parses/formats/detects the string `<path>.canvas#<Label>`. The host extends its `openFile` handling to open the target canvas and focus the node by label (via a `pendingFocus` map + the existing `focusNodeById`). A new `noderef` diamond node, a `c c` copy hotkey + context menu, and paste detection produce and consume references.

**Tech Stack:** TypeScript, React + @xyflow/react (React Flow v12), VS Code extension host, esbuild, `node --test` for `.mjs` unit tests.

**Spec:** `docs/superpowers/specs/2026-08-08-canvas-node-references-design.md`

---

### Task 1: Pure reference module `shared/nodeRef.ts`

Browser-safe (no `path`/`fs` imports) so both webview and host use it and it unit-tests via the `.mjs` pattern.

**Files:**
- Create: `src/shared/nodeRef.ts`
- Test: `test/node-ref.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/node-ref.mjs`:
```js
// - run: npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=test/.build/node-ref.mjs && node --test test/node-ref.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseNodeRef, formatNodeRef, isNodeRef } from './.build/node-ref.mjs';

test('parseNodeRef splits path and label', () => {
  assert.deepEqual(parseNodeRef('test/H1.canvas#N2'), { canvas: 'test/H1.canvas', label: 'N2' });
  assert.deepEqual(parseNodeRef('a/b c/x.canvas#E10'), { canvas: 'a/b c/x.canvas', label: 'E10' });
});

test('parseNodeRef trims surrounding whitespace', () => {
  assert.deepEqual(parseNodeRef('  x.canvas#K1\n'), { canvas: 'x.canvas', label: 'K1' });
});

test('parseNodeRef rejects non-references', () => {
  assert.equal(parseNodeRef('a note about x.canvas'), null);
  assert.equal(parseNodeRef('http://example.com#N2'), null);
  assert.equal(parseNodeRef('x.canvas#37'), null);      // - line-number-like, not a label
  assert.equal(parseNodeRef('x.py#N2'), null);          // - not a .canvas
});

test('formatNodeRef round-trips with parseNodeRef', () => {
  const s = formatNodeRef('test/H1.canvas', 'N2');
  assert.equal(s, 'test/H1.canvas#N2');
  assert.deepEqual(parseNodeRef(s), { canvas: 'test/H1.canvas', label: 'N2' });
});

test('isNodeRef is true only for valid references', () => {
  assert.equal(isNodeRef('test/H1.canvas#N2'), true);
  assert.equal(isNodeRef('just text'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=test/.build/node-ref.mjs && node --test test/node-ref.mjs`
Expected: FAIL — esbuild errors that `src/shared/nodeRef.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/shared/nodeRef.ts`:
```ts
/**
 * Cross-canvas node reference: the string `<path>.canvas#<Label>`.
 * Browser-safe (no path/fs) so the webview and host share it.
 * `Label` is a node's nodeLabel — one or more uppercase letters then digits (N2, E10, K1, D3).
 */

export interface NodeRef {
  canvas: string;   // - path to the .canvas file, as written (resolution is the host's job)
  label:  string;   // - target node's nodeLabel
}

// - <path ending in .canvas> # <LETTERS><DIGITS>. Rejects #<digits-only> (line anchors) and non-.canvas.
const REF_RE = /^(.+\.canvas)#([A-Z]+\d+)$/;

export function parseNodeRef(s: string): NodeRef | null {
  const m = REF_RE.exec(s.trim());
  return m ? { canvas: m[1], label: m[2] } : null;
}

export function formatNodeRef(canvasPath: string, label: string): string {
  return `${canvasPath}#${label}`;
}

export function isNodeRef(s: string): boolean {
  return parseNodeRef(s) !== null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=test/.build/node-ref.mjs && node --test test/node-ref.mjs`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/shared/nodeRef.ts test/node-ref.mjs
git commit -m "feat(noderef): pure parse/format/detect for canvas node references"
```

---

### Task 2: Types, label prefix, palette

**Files:**
- Modify: `src/shared/types.ts` (node interface + union ~line 102-142; message interfaces + union ~line 524-686)
- Modify: `src/shared/nodeLabels.ts:27-48` (`nodeLabelPrefix`)
- Modify: `src/webview/canvas/palette.ts:24` (accent color)

- [ ] **Step 1: Add the `NoderefNode` interface and union member**

In `src/shared/types.ts`, right after the `PortalNode` interface (ends ~line 106), add:
```ts
export interface NoderefNode extends CanvasNodeBase {
  type:   'noderef';
  canvas: string;   // - workspace-relative path to the target .canvas
  label:  string;   // - target node's nodeLabel (e.g. N2)
  title?: string;   // - display hint captured at create time
}
```
In the `CanvasNode` union (starts ~line 135, after `| PortalNode`), add a line:
```ts
  | NoderefNode
```

- [ ] **Step 2: Add the two messages and union members**

In `src/shared/types.ts`, near `MsgOpenFile` (~line 524), add:
```ts
export interface MsgCopyNodeReference { type: 'copyNodeReference'; label: string; }
export interface MsgFocusNode         { type: 'focusNode'; id: string; }
```
Add both to whichever message union(s) `MsgOpenFile` belongs to (search the file for `| MsgOpenFile` — there is a webview→host union and a host→webview union; put `MsgCopyNodeReference` in the same union as `MsgOpenFile` (webview→host), and `MsgFocusNode` in the host→webview union alongside messages like `MsgChatModelInfo`).

- [ ] **Step 3: Add the label prefix**

In `src/shared/nodeLabels.ts`, inside `nodeLabelPrefix`'s switch (after `case 'portal': return 'R';`), add:
```ts
    case 'noderef': return 'D';
```
Also add `noderef` to the label-scheme docstring at the top (line list): `D  — node references (diamond) to a node in another canvas`.

- [ ] **Step 4: Add the accent color**

In `src/webview/canvas/palette.ts`, after the `portal:` entry (~line 24), add to the same map:
```ts
  noderef: '#c98af0',                // - node reference (diamond) to a node in another canvas
```
If there is a `DEFAULT_NODE_BORDER_BY_TYPE` map in the same file, add `noderef: '#c98af0'` there too (match the portal entry's shape).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -v ResolvedNotion`
Expected: no NEW errors (only the 3 pre-existing `ResolvedNotion`/`ResolvedUri` lines, which are filtered out → empty output).

```bash
git add src/shared/types.ts src/shared/nodeLabels.ts src/webview/canvas/palette.ts
git commit -m "feat(noderef): NoderefNode type, focus/copy messages, D label prefix, palette"
```

---

### Task 3: `NoderefNode.tsx` diamond component + registration

**Files:**
- Create: `src/webview/canvas/nodes/NoderefNode.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx:48` (import) and `:63` (`NODE_TYPES` map)
- Modify: the node-title helper used for the chat context/summary (search `nodeTitle` in `src/extension/context-builder.ts` and any webview summary) to give `noderef` a readable title.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/nodes/NoderefNode.tsx` (model on `PortalNode.tsx`; a node ref opens `canvas#label`, not just a canvas):
```tsx
/**
 * NoderefNode — a diamond that references a labelled node in another canvas.
 * Click or Enter opens that canvas and focuses the node (host resolves canvas#label).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { NoderefNode } from '../../../shared/types';
import { formatNodeRef } from '../../../shared/nodeRef';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function NoderefNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node   = data as unknown as NoderefNode;
  const accent = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.noderef ?? '#c98af0';
  const base   = node.canvas.replace(/\.canvas$/, '').split('/').pop() ?? node.canvas;
  const ref    = useRef<HTMLDivElement | null>(null);

  const open = useCallback(() => {
    vscodePostMessage({ type: 'openFile', uri: formatNodeRef(node.canvas, node.label) });
  }, [node.canvas, node.label]);

  // - Enter while this node is keyboard-focused → activate
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); open(); } };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as { createdBy?: string }).createdBy} />
      <div
        ref={ref}
        tabIndex={0}
        onDoubleClick={open}
        onClick={open}
        title={`Open ${node.canvas} → ${node.label}`}
        style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          outline: 'none', cursor: 'pointer',
        }}
      >
        {/* - diamond: a rotated square behind upright text */}
        <div style={{
          position: 'absolute', inset: 0, transform: 'rotate(45deg)', borderRadius: 8,
          border: `2px solid ${accent}`,
          background: 'var(--vscode-editorWidget-background, #202020)',
          boxShadow: selected ? `0 0 0 2px ${accent}` : '0 2px 8px rgba(0,0,0,0.45)',
        }} />
        <div style={{ position: 'relative', textAlign: 'center', padding: 6, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{base} › {node.label}</div>
          {node.title && (
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
```

- [ ] **Step 2: Register the node type**

In `src/webview/canvas/CanvasView.tsx`, add near line 48 (with the other node imports):
```ts
import { NoderefNodeComponent } from './nodes/NoderefNode';
```
And in the `NODE_TYPES` map (~line 63, alongside `portal: PortalNodeComponent,`):
```ts
  noderef: NoderefNodeComponent,
```

- [ ] **Step 3: Give it a readable title for context/summary**

In `src/extension/context-builder.ts`, find `nodeTitle` (used for the node summary list). Add a `noderef` branch that returns `${basename(node.canvas)} › ${node.label}` so the AI context and any summary read cleanly. Concretely, in the `switch (node.type)` (or if/else chain) add:
```ts
    case 'noderef': return `${(node as { canvas: string }).canvas.split('/').pop()} › ${(node as { label: string }).label}`;
```

- [ ] **Step 4: Build and eyeball**

Run: `npm run build 2>&1 | tail -3`
Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/nodes/NoderefNode.tsx src/webview/canvas/CanvasView.tsx src/extension/context-builder.ts
git commit -m "feat(noderef): diamond node component + registration + summary title"
```

---

### Task 4: Host open-and-focus primitive

**Files:**
- Modify: `src/extension/editor-provider.ts` — `handleOpenFile` (~735), add a `pendingFocus` field on the provider class, add focus-on-ready in the `canvasLoaded`/`webviewReady` path, handle a new webview message for the ready hook if needed.
- Modify: `src/webview/canvas/CanvasView.tsx` — handle the `focusNode` host message → `focusNodeById`.

- [ ] **Step 1: Add the pendingFocus map to the provider**

Near the other provider fields in `editor-provider.ts` (e.g., beside `panelsByPath`), add:
```ts
  // - canvasPath → label to focus once that canvas's webview is ready (cross-canvas node refs)
  private pendingFocus = new Map<string, string>();
```

- [ ] **Step 2: Branch `handleOpenFile` for `.canvas#<Label>`**

At the top of `handleOpenFile` (after it computes the resolved `target`, before the `#L?(\d+)` line-fragment logic ~line 749), add:
```ts
    // - cross-canvas node reference: <path>.canvas#<Label> → open that canvas + focus the node
    const refMatch = target.match(/^(.*\.canvas)#([A-Z]+\d+)$/);
    if (refMatch) {
      const [, refPath, label] = refMatch;
      const resolved = this.resolveCanvasRefPath(refPath, canvasDir);   // - Step 3
      if (!resolved) { vscode.window.showWarningMessage(`Skena: ${refPath} not found`); return; }
      this.pendingFocus.set(resolved, label);
      const uri = vscode.Uri.file(resolved);
      await vscode.commands.executeCommand('vscode.openWith', uri, 'skena.canvasEditor');   // - match the editor viewType id used elsewhere
      this.tryFocusPending(resolved);   // - Step 4: fire now if the panel is already live
      return;
    }
```
Note: use the exact custom-editor viewType id registered for Skena (search `registerCustomEditorProvider(` in `src/extension/extension.ts` for the string; substitute it for `'skena.canvasEditor'`).

- [ ] **Step 3: Add the path resolver**

Add a private method to the provider:
```ts
  // - resolve a canvas ref path: relative to the referencing canvas dir → workspace root → absolute
  private resolveCanvasRefPath(refPath: string, referencingDir: string): string | null {
    const roots = [
      path.resolve(referencingDir, refPath),
      ...(vscode.workspace.workspaceFolders ?? []).map(f => path.resolve(f.uri.fsPath, refPath)),
      path.isAbsolute(refPath) ? refPath : '',
    ].filter(Boolean);
    for (const p of roots) { try { if (require('fs').existsSync(p)) return p; } catch { /* ignore */ } }
    return null;
  }
```

- [ ] **Step 4: Focus when the target canvas is ready**

Add a helper that sends the focus once the panel exists, and resolves label→id from the loaded document:
```ts
  // - if the canvas at `fsPath` has a live panel, resolve its pending label→node id and focus it
  private tryFocusPending(fsPath: string): void {
    const label = this.pendingFocus.get(fsPath);
    if (!label) return;
    const panel = SkenaEditorProvider.panelsByPath.get(fsPath);
    if (!panel) return;   // - not ready yet; the ready hook (Step 5) will retry
    const doc = this.docByPath.get(fsPath);   // - use whatever map the provider already keeps; else read the file
    const node = doc?.canvas.nodes.find(n => n.nodeLabel === label);
    if (node) panel.webview.postMessage({ type: 'focusNode', id: node.id });
    else vscode.window.showWarningMessage(`Skena: ${label} not found in ${path.basename(fsPath)}`);
    this.pendingFocus.delete(fsPath);
  }
```
If the provider has no `docByPath`, resolve the label against the document reachable from the panel's `resolveCustomTextEditor` closure instead; simplest is to call `tryFocusPending` from inside the existing `canvasLoaded` send path (Step 5), where `document` is in scope — resolve `document.canvas.nodes.find(n => n.nodeLabel === label)` there directly.

- [ ] **Step 5: Fire the focus from the canvas-ready path**

In `resolveCustomTextEditor`, where the host sends `{ type: 'canvasLoaded', ... }` (there are two such sends, ~line 205 and ~475), immediately AFTER the send add:
```ts
        const wantLabel = this.pendingFocus.get(document.uri.fsPath);
        if (wantLabel) {
          const target = document.canvas.nodes.find(n => n.nodeLabel === wantLabel);
          if (target) send({ type: 'focusNode', id: target.id });
          else vscode.window.showWarningMessage(`Skena: ${wantLabel} not found in ${path.basename(document.uri.fsPath)}`);
          this.pendingFocus.delete(document.uri.fsPath);
        }
```
(This replaces the need for `docByPath` in Step 4; keep `tryFocusPending` only for the already-open case, or drop it and rely solely on this ready-path hook if `openWith` always reloads. Prefer this ready-path hook as the single source of truth; if the canvas was already open and does not re-fire `canvasLoaded`, also post from `tryFocusPending` using the panel + a fresh file read.)

- [ ] **Step 6: Handle `focusNode` in the webview**

In `src/webview/App.tsx`, in the message switch (near the `chatModelInfo` case), add:
```ts
        case 'focusNode':
          window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id: msg.id } }));
          break;
```
In `src/webview/canvas/CanvasView.tsx`, there is already a `skena:focusNode` listener that calls `focusNodeById` for intra-canvas navigation (search `skena:focusNode`). Confirm it selects + centers; if the existing listener only sets DOM focus, extend it to also call `focusNodeById(id)` (which does `setCenter`). Add if missing:
```ts
  useEffect(() => {
    const onFocus = (e: Event) => focusNodeById((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('skena:focusNodeCenter', onFocus);
    return () => window.removeEventListener('skena:focusNodeCenter', onFocus);
  }, [focusNodeById]);
```
and dispatch `skena:focusNodeCenter` from App.tsx instead of `skena:focusNode` if the plain one does not center. Choose one event name and use it consistently.

- [ ] **Step 7: Build, then manual smoke**

Run: `npm run build 2>&1 | tail -3`
Manual: create a text node in `test/H1.canvas`, note its label (say `N9`). In a second canvas add a text node containing a markdown link `[go](H1.canvas#N9)` (relative to that canvas's folder). Reload. Click the link → `H1.canvas` opens and centers `N9`. Then edit the link to a missing label → click → warning, canvas still opens.

- [ ] **Step 8: Commit**

```bash
git add src/extension/editor-provider.ts src/webview/App.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat(noderef): host open-and-focus for canvas#label; webview focusNode"
```

---

### Task 5: Copy reference — `c c` hotkey + context menu

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx:1809-1825` (repurpose the `c,c` double-tap)
- Modify: `src/extension/editor-provider.ts` (new `copyNodeReference` message handler)
- Modify: `package.json` (context-menu command, if the node context menu is contributed there; otherwise wire into the webview node context menu)

- [ ] **Step 1: Repurpose the `c c` double-tap**

Replace the body of the `c,c` handler in `CanvasView.tsx` (~1811-1824, the block that currently posts `copyAbsolutePath`) with:
```ts
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'c') {
        const now = Date.now();
        if (now - lastCPressRef.current < 400) {
          lastCPressRef.current = 0;
          const focused = nodesRef.current.find(n => n.selected && n.type !== 'group');
          const label = focused ? (focused.data as Record<string, unknown>).nodeLabel as string | undefined : undefined;
          if (focused && label) {
            e.preventDefault();
            vscodePostMessage({ type: 'copyNodeReference', label });
          }
          return;
        }
        lastCPressRef.current = now;
      }
```

- [ ] **Step 2: Handle `copyNodeReference` in the host**

In `editor-provider.ts` message switch, add a case:
```ts
        case 'copyNodeReference': {
          const rel = this.sessionNameFor(document);   // - workspace-rel path WITHOUT .canvas
          const refStr = `${rel}.canvas#${msg.label}`;
          await vscode.env.clipboard.writeText(refStr);
          void vscode.window.setStatusBarMessage(`Skena: copied reference ${msg.label}`, 2000);
          break;
        }
```
Note: `sessionNameFor` (added earlier) strips `.canvas`; re-append it so the ref is a valid `.canvas#label`. If a distinct helper is cleaner, add `private canvasRelPath(document)` returning the workspace-relative path WITH the extension and use it here.

- [ ] **Step 3: Context-menu item**

If Skena renders its own node context menu in the webview (search for a right-click menu in `CanvasView.tsx`/a menu component), add a **"Copy node reference"** item that runs the same `vscodePostMessage({ type: 'copyNodeReference', label })` for the right-clicked node. If instead the menu is a VS Code `menus` contribution in `package.json`, add a command `skena.copyNodeReference` and a `webview/context` (or the existing node menu) entry, and register the command in `extension.ts` to message the active panel. Pick whichever matches the existing node menu implementation; do not add a second menu system.

- [ ] **Step 4: Build + manual smoke**

Run: `npm run build 2>&1 | tail -3`
Manual: focus a node, press `c c` → status bar shows "copied reference <label>"; paste into a text editor → `path.canvas#<label>` appears with the correct workspace-relative path.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx src/extension/editor-provider.ts package.json
git commit -m "feat(noderef): copy reference via c c hotkey + context menu (replaces copy-abs-path)"
```

---

### Task 6: Paste a reference → diamond node

**Files:**
- Modify: `src/extension/editor-provider.ts` — the paste-as-node path (where clipboard text becomes a node). Detect `isNodeRef` and build a `noderef` node.

- [ ] **Step 1: Locate the paste-to-node construction**

Find where a pasted clipboard STRING is turned into a node (search `type: 'link'` / `type: 'text'` creation in the paste path, likely a `handlePaste`/`pasteAsNode` in `editor-provider.ts`, reached from a webview `paste` message with the target x/y). Identify the branch order: image → file → url → text.

- [ ] **Step 2: Add a node-reference branch FIRST**

Before the url/text branches, add (using the shared detector):
```ts
    import { parseNodeRef } from '../shared/nodeRef';   // - top-of-file import
    // ...
    const ref = parseNodeRef(clipboardText);
    if (ref) {
      // - resolve the target's current title as a display hint (best effort)
      let title: string | undefined;
      const resolved = this.resolveCanvasRefPath(ref.canvas, canvasDir);
      if (resolved) {
        try {
          const tgt = (await readCanvas(resolved)).nodes.find(n => n.nodeLabel === ref.label);
          if (tgt) title = nodeTitleFor(tgt);   // - reuse the same title helper used elsewhere (extract if needed)
        } catch { /* ignore */ }
      }
      const node = assignLabel({
        id: `ref-${Date.now().toString(36)}`, type: 'noderef',
        canvas: ref.canvas, label: ref.label, title,
        x, y, width: 200, height: 120,
      } as CanvasNode, canvas.nodes) as CanvasNode;
      // - push node, persist, and tell the webview to add it (mirror the existing text/url paste result)
      // ... follow the SAME persistence + addNodeResult path the text/url branches use ...
      return;
    }
```
Match the exact persistence/return shape the neighboring branches use (push to `canvas.nodes`, write, send `addNodeResult` or equivalent). Do not invent a new path.

- [ ] **Step 3: Build + manual smoke**

Run: `npm run build 2>&1 | tail -3`
Manual: `c c` on a node in canvas A, then in canvas B press the paste-as-node shortcut → a diamond `A › <label>` appears at the paste point; clicking it opens A centered on the node. Also paste a hand-typed `A.canvas#N1` → same.

- [ ] **Step 4: Commit**

```bash
git add src/extension/editor-provider.ts
git commit -m "feat(noderef): paste a canvas#label string as a diamond reference node"
```

---

### Task 7: Markdown link passthrough

**Files:**
- Modify (verify): `src/webview/renderers/MarkdownRenderer.tsx:80-88` (ReactMarkdown `a` onClick already posts `openFile`)
- Modify (verify): `src/extension/markdown-html.ts` (host-rendered links)

- [ ] **Step 1: Confirm ReactMarkdown passes `.canvas#Label` unaltered**

Read `MarkdownRenderer.tsx:80-88`. The `a` onClick posts `{ type:'openFile', uri: href }` verbatim — so `[t](H1.canvas#N2)` already reaches the host branch from Task 4. No change expected. If the renderer rewrites or strips `#`, fix so the href passes through unchanged.

- [ ] **Step 2: Confirm host-rendered markdown links reach `openFile`**

In `src/extension/markdown-html.ts`, verify link `href`s are emitted verbatim and the webview click handler for host-rendered HTML posts `openFile` with the full `href` (including `#N2`). If a line-anchor rewrite (`#L<n>`) touches non-numeric fragments, guard it so `#<Label>` is left intact. Add a test note or a small guard `if (/#L?\d+$/.test(href))` around any line-anchor rewrite.

- [ ] **Step 3: Build + manual smoke**

Run: `npm run build 2>&1 | tail -3`
Manual: in a `.md` FILE node and in an inline TEXT node, add `[go](H1.canvas#N9)`; both, when clicked in rendered view, open `H1.canvas` centered on `N9`.

- [ ] **Step 4: Commit**

```bash
git add src/webview/renderers/MarkdownRenderer.tsx src/extension/markdown-html.ts
git commit -m "fix(noderef): pass .canvas#Label markdown links through to open-and-focus"
```

---

### Task 8: Full verify + package

- [ ] **Step 1: Unit tests green**

Run: `npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=test/.build/node-ref.mjs && node --test test/node-ref.mjs`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v ResolvedNotion`
Expected: empty (only the 3 pre-existing `ResolvedNotion`/`ResolvedUri` errors, filtered out).

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -3`
Expected: success.

- [ ] **Step 4: End-to-end manual matrix**

- `c c` copy in A → paste in B → diamond → click opens A centered on the node.
- Hand-typed `A.canvas#N1` pasted → diamond.
- Markdown link in a text node and a `.md` file node → click opens + centers.
- Delete the target node → click → warning `"<label> not found in <basename>"`, A still opens.
- Reference to a node in the SAME canvas → focuses in place.

- [ ] **Step 5: Commit any fixes, then stop**

```bash
git add -A && git commit -m "test(noderef): verify end-to-end reference flows"
```
Do NOT bump the version or package here — the human decides when to cut a VSIX.

---

## Self-review notes (author)

- **Spec coverage:** reference format (Task 1), resolver/primitive (Task 4), diamond node (Task 3), copy hotkey+menu (Task 5), paste (Task 6), markdown links (Task 7), path resolution order (Task 4 Step 3), not-found warnings (Task 4 Steps 4-5), types/prefix/palette (Task 2). All spec sections mapped.
- **Known soft spots the implementer must pin down against the real code (not placeholders — explicit lookups):** the custom-editor viewType string (Task 4 Step 2); the exact paste-as-node branch shape (Task 6 Step 2); whether the node context menu is webview-rendered or a `package.json` contribution (Task 5 Step 3); the existing `skena:focusNode` listener's centering behavior (Task 4 Step 6). Each step says where to look and what to match.
- **Type consistency:** `NoderefNode { canvas, label, title? }`, message `copyNodeReference { label }` and `focusNode { id }`, label prefix `D`, event name chosen once in Task 4 Step 6 — used consistently across Tasks 3/5/6.
