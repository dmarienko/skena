# Paste-to-Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting OS clipboard content (image / html / files / URL / path / text) onto the canvas creates the right node type, per `docs/superpowers/specs/2026-07-04-paste-to-node-design.md`.

**Architecture:** A pure `classifyClipboard` function decides the action; a window-level DOM `paste` listener in `CanvasView` executes it. Cell content routes through the existing `addCellNode`; files route through the existing `dropFiles` host round-trip (extended with a `connectTo` edge); text/link/file nodes insert via the existing `skena:addNodeResult` event path. One new host message pair (`verifyPath`) checks pasted filesystem paths.

**Tech Stack:** TypeScript, React (webview), VS Code extension host, esbuild, `node --test` for the pure classifier.

**Conventions that matter here:**
- Inline comments start with `# -` / `// -` and are terse.
- No `typing`-style verbosity; follow existing `src/shared/types.ts` interface style.
- `test/` is **gitignored** (working-tree artifacts, never committed) — run behavioral tests with `node --test` after compiling the module under test with esbuild.
- Build check: `npm run build`; type check: `npm run typecheck` (has 3 pre-existing errors in `editor-provider.ts` `copyAbsolutePath` — ignore those, introduce no new ones).

---

### Task 1: `classifyClipboard` pure module (TDD)

**Files:**
- Create: `src/webview/canvas/paste-classify.ts`
- Test: `test/paste-classify.mjs` (working-tree only, NOT committed — `test/` is gitignored)

- [ ] **Step 1: Write the failing test**

Create `test/paste-classify.mjs`:

```js
// test/paste-classify.mjs
// - behavioral tests for the paste clipboard classifier.
// - run: npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=test/.build/paste-classify.mjs && node --test test/paste-classify.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyClipboard } from './.build/paste-classify.mjs';

const base = { hasImage: false, html: '', uriList: '', text: '', yySnapshot: null };

test('image beats everything', () => {
  const a = classifyClipboard({ ...base, hasImage: true, html: '<b>x</b>', uriList: 'file:///a', text: 'hi' });
  assert.equal(a.kind, 'cell-image');
});

test('html beats uri-list and text', () => {
  const a = classifyClipboard({ ...base, html: '<table><tr><td>1</td></tr></table>', uriList: 'file:///a', text: '1' });
  assert.equal(a.kind, 'cell-html');
  assert.match(a.html, /<table>/);
});

test('browser-URL guard: html flavor + single-line URL plain text -> link', () => {
  const a = classifyClipboard({ ...base, html: '<a href="https://x.io">x</a>', text: 'https://x.io/page' });
  assert.deepEqual(a, { kind: 'link', url: 'https://x.io/page' });
});

test('uri-list -> files, comment lines stripped', () => {
  const a = classifyClipboard({ ...base, uriList: '# comment\r\nfile:///a.md\r\nfile:///b.py\r\n' });
  assert.deepEqual(a, { kind: 'files', uris: ['file:///a.md', 'file:///b.py'] });
});

test('text equal to yy snapshot -> internal paste', () => {
  const a = classifyClipboard({ ...base, text: 'copied nodes', yySnapshot: 'copied nodes' });
  assert.equal(a.kind, 'internal');
});

test('text differing from yy snapshot -> content paste', () => {
  const a = classifyClipboard({ ...base, text: 'newer external copy', yySnapshot: 'copied nodes' });
  assert.deepEqual(a, { kind: 'text', text: 'newer external copy' });
});

test('single-line http(s) URL -> link, whitespace trimmed', () => {
  assert.deepEqual(classifyClipboard({ ...base, text: '  https://ex.com/a?b=1 \n' }), { kind: 'link', url: 'https://ex.com/a?b=1' });
  assert.equal(classifyClipboard({ ...base, text: 'http://ex.com' }).kind, 'link');
});

test('multi-line text containing a URL -> text node', () => {
  const a = classifyClipboard({ ...base, text: 'see this:\nhttps://ex.com' });
  assert.equal(a.kind, 'text');
});

test('single-line file:// or absolute or ~/ path -> verify-path', () => {
  assert.deepEqual(classifyClipboard({ ...base, text: 'file:///home/u/x.md' }), { kind: 'verify-path', raw: 'file:///home/u/x.md' });
  assert.deepEqual(classifyClipboard({ ...base, text: '/home/u/x.md' }),        { kind: 'verify-path', raw: '/home/u/x.md' });
  assert.deepEqual(classifyClipboard({ ...base, text: '~/docs/x.md' }),         { kind: 'verify-path', raw: '~/docs/x.md' });
});

test('plain multi-line text -> text node, empty -> none', () => {
  assert.equal(classifyClipboard({ ...base, text: 'line1\nline2' }).kind, 'text');
  assert.equal(classifyClipboard(base).kind, 'none');
  assert.equal(classifyClipboard({ ...base, text: '   ' }).kind, 'none');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/devs/skena
npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=test/.build/paste-classify.mjs
```
Expected: esbuild FAILS — `Could not resolve "src/webview/canvas/paste-classify.ts"` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/webview/canvas/paste-classify.ts`:

```ts
// - pure clipboard classifier for paste-to-node; no DOM, no vscode — unit-testable standalone.
// - priority per spec: image > html > uri-list > text (yy-internal / url / path / plain).

export interface ClipboardInput {
  hasImage:   boolean;
  html:       string;          // - text/html flavor, '' if absent
  uriList:    string;          // - raw text/uri-list, '' if absent
  text:       string;          // - text/plain flavor, '' if absent
  yySnapshot: string | null;   // - OS clipboard text captured at last yy, null if never
}

export type PasteAction =
  | { kind: 'cell-image' }
  | { kind: 'cell-html'; html: string }
  | { kind: 'files'; uris: string[] }
  | { kind: 'internal' }
  | { kind: 'link'; url: string }
  | { kind: 'verify-path'; raw: string }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

const isSingleLine = (s: string) => !/\r|\n/.test(s);
const isUrl  = (s: string) => /^https?:\/\/\S+$/.test(s);
const isPath = (s: string) => /^(file:\/\/|\/|~\/)/.test(s) && !/\s/.test(s);

export function classifyClipboard(input: ClipboardInput): PasteAction {
  const trimmed = input.text.trim();

  if (input.hasImage) return { kind: 'cell-image' };

  // - browser-URL guard: copied links often carry anchor markup in text/html;
  // - the single-line URL plain flavor is the truer intent
  if (input.html.trim()) {
    if (isSingleLine(trimmed) && isUrl(trimmed)) return { kind: 'link', url: trimmed };
    return { kind: 'cell-html', html: input.html };
  }

  if (input.uriList.trim()) {
    const uris = input.uriList.split(/\r?\n/).map(u => u.trim()).filter(u => u && !u.startsWith('#'));
    if (uris.length > 0) return { kind: 'files', uris };
  }

  if (trimmed) {
    if (input.yySnapshot !== null && input.text === input.yySnapshot) return { kind: 'internal' };
    if (isSingleLine(trimmed)) {
      if (isUrl(trimmed))  return { kind: 'link', url: trimmed };
      if (isPath(trimmed)) return { kind: 'verify-path', raw: trimmed };
    }
    return { kind: 'text', text: input.text };
  }

  return { kind: 'none' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/devs/skena
npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=test/.build/paste-classify.mjs && node --test test/paste-classify.mjs
```
Expected: all tests PASS (11 pass, 0 fail).

- [ ] **Step 5: Commit (source only — `test/` is gitignored)**

```bash
git add src/webview/canvas/paste-classify.ts
git commit -m "feat(paste): pure clipboard classifier for paste-to-node"
```

---

### Task 2: `verifyPath` + `showWarning` message pairs (types + host)

**Files:**
- Modify: `src/shared/types.ts` (message interfaces + the unions where `MsgDropFiles` / `MsgAddNodeResult` are listed)
- Modify: `src/extension/editor-provider.ts` (message switch, near `case 'dropFiles':` at ~line 301)

- [ ] **Step 1: Add message types to `src/shared/types.ts`**

Place next to `MsgDropFiles` (~line 444):

```ts
/** - webview → host: does this pasted filesystem path exist? */
export interface MsgVerifyPath {
  type:      'verifyPath';
  requestId: string;
  path:      string;   // - raw pasted text: file:// URI, absolute, or ~/ path
}

/** - host → webview: verifyPath answer */
export interface MsgVerifyPathResult {
  type:         'verifyPathResult';
  requestId:    string;
  exists:       boolean;
  /** - canvas-dir-relative path suitable for a FileNode.file, set when exists */
  resolvedPath?: string;
}

/** - webview → host: show a VS Code warning toast */
export interface MsgShowWarning {
  type: 'showWarning';
  text: string;
}
```

Add `MsgVerifyPath` and `MsgShowWarning` to the webview→host union and `MsgVerifyPathResult` to the host→webview union (the same unions that contain `MsgDropFiles` / `MsgAddNodeResult` — search for `| MsgDropFiles` and `| MsgAddNodeResult`).

- [ ] **Step 2: Handle the messages in `editor-provider.ts`**

In the webview message switch (next to `case 'dropFiles':`, ~line 301), add:

```ts
case 'verifyPath': {
  // - expand ~ and file://, answer with canvas-dir-relative path (same convention as dropFiles nodes)
  const os = require('os') as typeof import('os');
  let p = msg.path.startsWith('file://') ? vscode.Uri.parse(msg.path).fsPath : msg.path;
  if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
  let exists = false;
  try { exists = fs.statSync(p).isFile(); } catch { /* - stays false */ }
  send({
    type: 'verifyPathResult',
    requestId: msg.requestId,
    exists,
    resolvedPath: exists ? path.relative(canvasDir, p) : undefined,
  });
  break;
}
case 'showWarning':
  vscode.window.showWarningMessage(msg.text);
  break;
```

Notes for the implementer:
- `fs`, `path`, `vscode` are already imported in this file; check how `canvasDir` is in scope for the `dropFiles` case and mirror it exactly (same closure).
- Use the ES import style the file already uses for `os` if one exists — check top of file first; only `require` if the file has no `os` import and follow its existing import conventions instead if it does.
- Look at `handleDropFiles` first: if it produces vault-relative (`vault://`) paths for files inside a configured vault, reuse that resolution helper here instead of bare `path.relative` so pasted paths and dropped files produce identical FileNodes.

- [ ] **Step 3: Route `verifyPathResult` to the webview event bus**

In `src/webview/App.tsx`, in the host-message switch (next to `case 'nodesFromDrop':` at ~line 131), add:

```ts
case 'verifyPathResult':
  window.dispatchEvent(new CustomEvent('skena:verifyPathResult', { detail: msg }));
  break;
```

- [ ] **Step 4: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; typecheck shows ONLY the 3 pre-existing `copyAbsolutePath` errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/editor-provider.ts src/webview/App.tsx
git commit -m "feat(paste): verifyPath + showWarning message pairs"
```

---

### Task 3: `dropFiles` gains `connectTo` (edge to focused node)

**Files:**
- Modify: `src/shared/types.ts` (`MsgDropFiles`, ~line 444; and the `nodesFromDrop` host→webview message interface — search `nodesFromDrop`)
- Modify: `src/extension/editor-provider.ts` (`handleDropFiles` — pass-through)
- Modify: `src/webview/App.tsx:131` (`case 'nodesFromDrop':` — forward payload)
- Modify: `src/webview/canvas/CanvasView.tsx:680-705` (drop-resolved handler — create edges)

- [ ] **Step 1: Extend the message types**

```ts
export interface MsgDropFiles {
  type: 'dropFiles';
  uris: string[];
  position: { x: number; y: number };
  /** - when set, webview draws an arrow edge from this node to each dropped node */
  connectTo?: string;
}
```

Find the `nodesFromDrop` host→webview interface (search `'nodesFromDrop'` in types.ts) and add `connectTo?: string` to it. In `handleDropFiles` (editor-provider.ts), echo `msg.connectTo` into the `nodesFromDrop` reply.

- [ ] **Step 2: Forward through App.tsx**

`case 'nodesFromDrop':` currently dispatches only the nodes array. Change the event detail to `{ nodes: msg.nodes, connectTo: msg.connectTo }` (keep the event name).

- [ ] **Step 3: Create edges in the CanvasView handler**

In the drop-resolved `useEffect` (CanvasView.tsx ~line 681), update the detail type to `{ nodes: CanvasNode[]; connectTo?: string }` and, after nodes are inserted, add for each labelled node when `connectTo` is set and exists in `canvasRef.current.nodes`:

```ts
const newEdges: CanvasEdge[] = connectTo
  ? labelled.map((cn, i) => ({
      id:       `edge-paste-${Date.now()}-${i}`,
      fromNode: connectTo,
      fromSide: 'right' as NodeSide,
      toNode:   cn.id,
      toSide:   'left' as NodeSide,
      toEnd:    'arrow' as const,
    }))
  : [];
if (newEdges.length > 0) {
  setEdges(eds => [...eds, ...newEdges.map(toFlowEdge)]);
  canvasRef.current = { ...canvasRef.current, edges: [...canvasRef.current.edges, ...newEdges] };
}
```

(Insert inside the same handler so it shares the existing `pushHistory()`/`scheduleSave()` calls — do not add extra ones.)

- [ ] **Step 4: Build + typecheck, verify drag-and-drop still works**

```bash
npm run build && npm run typecheck
```
Expected: clean (modulo the 3 pre-existing errors). Existing `onDrop` callers pass no `connectTo` → behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/editor-provider.ts src/webview/App.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat(paste): dropFiles supports connectTo edge"
```

---

### Task 4: yy snapshot of the OS clipboard

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (yy handler ~line 1439; new refs + listener near the other `useEffect`s)

- [ ] **Step 1: Add refs and the snapshot listener**

Near the other refs in `CanvasView`:

```ts
// - OS clipboard text captured at last yy; discriminates internal vs content paste (no clipboard timestamps exist)
const yySnapshotRef       = useRef<string | null>(null);
const awaitingYYSnapshot  = useRef(false);
```

New `useEffect` (alongside the Ctrl+Shift+V one at ~line 1903, which already listens to `skena:clipboardContent`):

```ts
// - record the OS clipboard text that was current when yy happened
useEffect(() => {
  const onClip = (e: Event) => {
    if (!awaitingYYSnapshot.current) return;
    awaitingYYSnapshot.current = false;
    yySnapshotRef.current = (e as CustomEvent<string>).detail;
  };
  window.addEventListener('skena:clipboardContent', onClip);
  return () => window.removeEventListener('skena:clipboardContent', onClip);
}, []);
```

- [ ] **Step 2: Stamp on yy**

In the yy double-tap branch (~line 1439, where `clipboard = {...}` is set), add right after the internal clipboard is filled:

```ts
// - snapshot OS clipboard so Ctrl+V can tell "yy then paste" from "external copy then paste"
awaitingYYSnapshot.current = true;
vscodePostMessage({ type: 'requestClipboardRead' });
```

CAUTION: the Ctrl+Shift+V flow (~line 1914) also triggers `requestClipboardRead` and listens to the same `skena:clipboardContent` event — the guard flag keeps the two flows from stealing each other's reads, and the host pushes an unsolicited `clipboardContent` on webview load (editor-provider ~line 173) which the flag also ignores. Verify the Ctrl+Shift+V listener has its own pending-flag; if it consumes events unconditionally, gate it the same way.

- [ ] **Step 3: Build + typecheck + commit**

```bash
npm run build && npm run typecheck
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat(paste): yy snapshots OS clipboard for smart-paste discrimination"
```

---

### Task 5: the paste listener + action execution

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (new `useEffect` + helpers; extract internal paste from the `p` handler ~line 1465)

- [ ] **Step 1: Extract internal node paste into a callable**

The `p`-key branch (~line 1465) pastes the module-level `clipboard` inline (see `clipboard.nodes.map` ~line 894). Extract that body into:

```ts
const pasteInternalClipboard = useCallback(() => {
  if (!clipboard) return;
  // - (moved verbatim from the p-key branch: idMap, rawPasted with +40px offset, fresh labels,
  // -  edge remap, pushHistory, setNodes/setEdges, canvasRef update, scheduleSave)
}, [pushHistory, scheduleSave, setEdges]);
```

The `p` branch becomes `e.preventDefault(); pasteInternalClipboard(); return;`. Move VERBATIM — no behavior change. Run `npm run build`, smoke `yy` + `p` still works.

- [ ] **Step 2: Node builders for link / text / file paste**

Add helper (near `addCellNode`, ~line 1829). It places right of the focused node via `findFreePosition` with an arrow edge, else viewport centre without an edge, and inserts via the existing `skena:addNodeResult` event (which handles label, creationIndex, history, save, focus, autoEdit):

```ts
// - insert a pasted node right of the focused node (edge) or at viewport centre (no edge)
const insertPastedNode = useCallback((partial: Omit<CanvasNode, 'id' | 'x' | 'y'> & { width: number; height: number }) => {
  const focused = nodesRef.current.find(n => n.selected && n.type !== 'group');
  const nw = partial.width, nh = partial.height, GAP = 40;
  let x: number, y: number, edge: CanvasEdge | undefined;
  if (focused) {
    const cw = Number(focused.style?.width ?? 400);
    const pos = findFreePosition(nodesRef.current, focused.position.x + cw + GAP, focused.position.y, nw, nh, 1, 0);
    x = pos.x; y = pos.y;
  } else {
    const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
    x = Math.round((-vx + window.innerWidth / 2) / zoom - nw / 2);
    y = Math.round((-vy + window.innerHeight / 2) / zoom - nh / 2);
  }
  const id = `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node = { ...partial, id, x, y } as CanvasNode;
  if (focused) {
    edge = { id: `${focused.id}-${id}-${Date.now()}`, fromNode: focused.id, fromSide: 'right', toNode: id, toSide: 'left', toEnd: 'arrow' };
  }
  window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
    detail: { type: 'addNodeResult', node, edge } satisfies MsgAddNodeResult,
  }));
}, []);
```

(Match `findFreePosition`'s real signature — it's the one `addTextNodeInDirection` at ~line 789 uses.)

- [ ] **Step 3: The paste listener**

New `useEffect` in `CanvasView` (dependencies: the helpers used):

```ts
// - paste-to-node: DOM paste is the only channel that carries images/files (vscode clipboard API is text-only)
useEffect(() => {
  const pendingVerify = new Map<string, string>();   // - requestId → raw text (for text-node fallback)

  const onVerifyResult = (e: Event) => {
    const msg = (e as CustomEvent<MsgVerifyPathResult>).detail;
    const raw = pendingVerify.get(msg.requestId);
    if (raw === undefined) return;
    pendingVerify.delete(msg.requestId);
    if (msg.exists && msg.resolvedPath) {
      insertPastedNode({ type: 'file', file: msg.resolvedPath, width: 400, height: 300 } as never);
    } else {
      insertPastedNode({ type: 'text', text: raw, width: 400, height: 300 } as never);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    // - inert while any editor/input owns the keyboard (Monaco node edit, chat input, search, marks)
    const ae = document.activeElement as HTMLElement | null;
    if (ae?.closest('.monaco-editor, input, textarea, [contenteditable="true"]')) return;
    const cd = e.clipboardData;
    if (!cd) return;

    const imageItem = Array.from(cd.items).find(it => it.kind === 'file' && it.type.startsWith('image/'));
    const action = classifyClipboard({
      hasImage:   !!imageItem,
      html:       cd.getData('text/html'),
      uriList:    cd.getData('text/uri-list'),
      text:       cd.getData('text/plain'),
      yySnapshot: yySnapshotRef.current,
    });
    if (action.kind === 'none') { if (clipboard) { e.preventDefault(); pasteInternalClipboard(); } return; }
    e.preventDefault();

    const focused = nodesRef.current.find(n => n.selected && n.type !== 'group');
    switch (action.kind) {
      case 'cell-image': {
        const file = imageItem!.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => vscodePostMessage({ type: 'showWarning', text: 'Skena: failed to read pasted image.' });
        reader.onload = () => {
          const dataUri = reader.result as string;
          if (dataUri.length > 5 * 1024 * 1024) {
            vscodePostMessage({ type: 'showWarning', text: 'Skena: pasted image exceeds 5 MB — canvas file will grow accordingly.' });
          }
          addCellNode(dataUri, 'image', focused?.id);
        };
        reader.readAsDataURL(file);
        return;
      }
      case 'cell-html':
        addCellNode(action.html, 'html', focused?.id);
        return;
      case 'files': {
        // - reuse the drag-and-drop host round-trip; position near focused node or viewport centre
        const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
        const position = focused
          ? { x: focused.position.x + Number(focused.style?.width ?? 400) + 40, y: focused.position.y }
          : { x: (-vx + window.innerWidth / 2) / zoom, y: (-vy + window.innerHeight / 2) / zoom };
        vscodePostMessage({ type: 'dropFiles', uris: action.uris, position, connectTo: focused?.id });
        return;
      }
      case 'internal':
        pasteInternalClipboard();
        return;
      case 'link':
        insertPastedNode({ type: 'link', url: action.url, width: 400, height: 300 } as never);
        return;
      case 'verify-path': {
        const requestId = `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        pendingVerify.set(requestId, action.raw);
        // - 2s timeout → treat as non-existent (spec: error handling)
        setTimeout(() => {
          if (!pendingVerify.has(requestId)) return;
          pendingVerify.delete(requestId);
          insertPastedNode({ type: 'text', text: action.raw, width: 400, height: 300 } as never);
        }, 2000);
        vscodePostMessage({ type: 'verifyPath', requestId, path: action.raw });
        return;
      }
      case 'text':
        insertPastedNode({ type: 'text', text: action.text, width: 400, height: 300 } as never);
        return;
    }
  };

  window.addEventListener('skena:verifyPathResult', onVerifyResult);
  window.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('skena:verifyPathResult', onVerifyResult);
    window.removeEventListener('paste', onPaste);
  };
}, [insertPastedNode, pasteInternalClipboard, addCellNode]);
```

Implementer notes:
- Import `classifyClipboard` from `./paste-classify` and `MsgVerifyPathResult` from `../../shared/types`.
- The `as never` casts: build the node objects with the exact fields the `TextNode`/`LinkNode`/`FileNode` interfaces in `src/shared/types.ts` require — if a direct object literal typechecks, drop the cast.
- Check FloatingChat's container `stopPropagation` (FloatingChat.tsx ~line 499): it stops keydown/keyup, not paste — but VERIFY a paste while chat input is focused does not reach this listener (the `.monaco-editor` guard should catch it).
- If search (`searchOpen`) or marks panel (`marksOpen`) render plain inputs, the `input, textarea` guard covers them; verify by pasting while each is open.

- [ ] **Step 4: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: clean (modulo the 3 pre-existing errors).

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat(paste): paste-to-node — smart dispatch on canvas Ctrl+V"
```

---

### Task 6: manual smoke + release chores

**Files:**
- Modify: `README.md` (features + key table)
- Modify: `package.json` (version)

- [ ] **Step 1: Manual smoke test (VS Code, Extension Development Host or installed VSIX)**

1. Screenshot to clipboard → Ctrl+V on canvas → CellNode with image, edge from focused node. ✓
2. Notebook: right-click a chart output → Copy Output → Ctrl+V → CellNode image. ✓
3. Notebook: copy a table output (html flavor) → Ctrl+V → CellNode html. ✓
4. Copy file in VS Code Explorer → Ctrl+V → file node(s), edges to focused node. ✓
5. Copy URL in browser → Ctrl+V → link node (NOT a cell-html of anchor markup). ✓
6. Copy `~/some/existing.md` as text → Ctrl+V → file node; nonexistent path → text node. ✓
7. Copy multi-line text → Ctrl+V → text node. ✓
8. `yy` on nodes → Ctrl+V → internal node paste (duplicate nodes, +40px). ✓
9. `yy`, then copy text elsewhere, Ctrl+V → text node (external wins). ✓
10. Paste while editing a text node → Monaco receives it, no canvas node created. ✓
11. Paste while chat input focused → chat receives it. ✓
12. Drag-and-drop from Explorer still works (regression). ✓

- [ ] **Step 2: README**

Add to the vim table after the `Ctrl+Shift+V` row:

```markdown
| `Ctrl+V` | Paste clipboard as node — image/table → cell node, file → file node, URL → link node, text → text node; after `yy` pastes the copied nodes |
```

And a feature bullet under "Rich inline previews" section header area (one line, match README voice):

```markdown
### Paste anything
`Ctrl+V` on the canvas turns the clipboard into the right node: screenshots and notebook chart/table outputs become cell nodes, copied files become file nodes, URLs become link nodes, text becomes a text node — all wired to the focused node with an edge.
```

- [ ] **Step 3: Version bump + build + package**

```bash
# - package.json: "version": "0.3.0" → "0.4.0"
npm run package
```
Expected: `skena-0.4.0.vsix` builds clean.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "chore(release): v0.4.0 — paste-to-node"
```

- [ ] **Step 5: Update crtx wiki**

Append a session entry to `~/projects/crtx/log.md` and the skena project page (`~/projects/crtx/projects/skena.md`): paste-to-node built per spec, key decisions (CellNode for images/html, connectTo on dropFiles, yy snapshot discriminator), test location note (`test/paste-classify.mjs`, gitignored). Commit the wiki.

---

## Self-review (done at plan time)

- **Spec coverage**: dispatch table rows → Task 1 (classifier) + Task 5 (execution); notebook outputs → Tasks 1/5 via `addCellNode`; files → Task 3 + 5; yy discriminator → Task 4; verifyPath + toast → Task 2; placement/edge → Task 5 Step 2; error handling (FileReader error, 2 s verify timeout, empty no-op) → Task 5 Step 3; tests → Task 1; manual smoke → Task 6.
- **Types**: `PasteAction` kinds used in Task 5 match Task 1 definitions; `MsgVerifyPath(Result)`/`MsgShowWarning`/`connectTo` defined in Tasks 2-3 before use in Task 5.
- **Known checks delegated to implementer** (flagged inline): `findFreePosition` exact signature, `canvasDir` scope in editor-provider, vault-relative vs canvas-relative path convention in `handleDropFiles`, Ctrl+Shift+V listener guard interaction.
