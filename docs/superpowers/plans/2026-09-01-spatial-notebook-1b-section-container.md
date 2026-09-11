# Spatial Notebook 1b — Section Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `section` container — a kernel-tint-ready band that owns a set of nodes via an explicit `sectionId`, with a zoom-steady header (title · `#S` address · fold · delete), so every node belongs to a section and existing canvases migrate into sections on open.

**Architecture:** A new `section` node type renders as a band (modeled on `GroupNode`, behind everything, non-draggable). Membership is an explicit `sectionId` field on every other node — no geometric containment (groups own nothing today). The header is a **screen-space overlay** (React Flow `useStore(transform)`, same technique as `HelperLines`) so it never scales with zoom. A pure `wrapNodesInSection` transform runs on the host load path (after `normalizeCanvasToOrigin`) to migrate legacy canvases. Cross-canvas `#S3` addressing reuses the existing label-resolution path unchanged.

**Tech Stack:** TypeScript, React Flow v12 (`useStore`, `NodeResizer`, `hidden`), esbuild, `node:test` (tests in `test/*.mjs`, bundled to `test/.build/`; `test/` is gitignored — commits carry only `src/`).

**Branch:** Continue on `feature/spatial-notebook` (1a is already there). Do NOT build on `main`.

**Scope:** Section data model + migration + band + zoom-steady header (fold/delete) + a New-Section command + registering the type across all dispatch sites. **Excludes:** the packing engine and reflow (Plan 1c), kernel-as-section-attribute + run-with-upstream (Phase 2), move-nodes-between-sections and drop-doc→section (a later plan). Sections in 1b are static containers; nodes keep their current free placement inside them.

**Typecheck baseline:** `npm run typecheck` reports 3 pre-existing errors in `src/extension/editor-provider.ts` (`fsPath` on `ResolvedNotion`). "Clean" = no NEW errors beyond those 3.

**Design decisions carried in (confirmed by the user):** Fork 1 = a new `section` node type (not reusing `group`). Fork 2 = explicit `sectionId` membership (not geometric containment).

---

## File structure

- `src/shared/types.ts` — add `'section'` to `SkenaNodeType`, `sectionId?: string` to `CanvasNodeBase`, a `SectionNode` interface, `SectionNode` in the `CanvasNode` union.
- `src/shared/nodeLabels.ts` — add `case 'section': return 'S'`.
- `src/shared/sections.ts` *(new)* — pure `wrapNodesInSection(canvas)` migration + helpers; unit-tested.
- `src/extension/editor-provider.ts` — apply `wrapNodesInSection` on the load path; add a `newSection` message handler; register the `skena.newSection` command.
- `src/webview/canvas/nodes/SectionNode.tsx` *(new)* — the band component.
- `src/webview/canvas/SectionHeaders.tsx` *(new)* — the screen-space zoom-steady header overlay.
- `src/webview/canvas/CanvasView.tsx` — register `section` in `NODE_TYPES`, band behavior in `toFlowNode`, mount `<SectionHeaders>`, fold/delete/new-section handlers, treat `section` like `group` in the band-skip sites.
- `src/webview/canvas/palette.ts` — a `section` border color.
- `src/extension/mcp/server.ts`, `src/extension/context-builder.ts`, `src/webview/canvas/searchMatch.ts`, `src/webview/canvas/MarksPanel.tsx` — a `section` case in each type switch.
- `package.json` — the `skena.newSection` command contribution.

---

### Task 1: Types — `section` node type + `sectionId` membership

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `'section'` to the Skena node-type union**

In `src/shared/types.ts`, change (line ~17):
```ts
export type SkenaNodeType = 'cell' | 'chat' | 'portal' | 'kernel' | 'code' | 'noderef';
```
to:
```ts
export type SkenaNodeType = 'cell' | 'chat' | 'portal' | 'kernel' | 'code' | 'noderef' | 'section';
```

- [ ] **Step 2: Add `sectionId` to `CanvasNodeBase`**

Inside `interface CanvasNodeBase { ... }`, after the `editIndex?: number;` field (end of the interface, ~line 57), add:
```ts
  /**
   * Id of the section node this node belongs to. Every node except a section itself carries one
   * once migrated. Membership is explicit (not geometric) so it survives drags. Ignored by Obsidian.
   */
  sectionId?: string;
```

- [ ] **Step 3: Add the `SectionNode` interface**

After the `GroupNode` interface (ends ~line 76), add:
```ts
/** Section container — a kernel-tint-ready band that owns nodes (via their sectionId). */
export interface SectionNode extends CanvasNodeBase {
  type: 'section';
  /** - section title shown in the zoom-steady header */
  title?: string;
  /** - collapsed to just the header bar when true */
  folded?: boolean;
  /** - accent/tint color (a #rrggbb); kernel-derived in a later phase */
  accentColor?: string;
}
```

- [ ] **Step 4: Add `SectionNode` to the `CanvasNode` union**

In the `CanvasNode` union (ends ~line 158, `| CodeNode;`), add `| SectionNode`:
```ts
export type CanvasNode =
  | FileNode
  | TextNode
  | GroupNode
  | LinkNode
  | CellNode
  | ChatNode
  | PortalNode
  | NoderefNode
  | KernelNode
  | CodeNode
  | SectionNode;
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: the 3 pre-existing `fsPath` errors only. (Adding a union member can surface exhaustiveness gaps in `switch` statements without a `default` — if any NEW error appears naming a switch over `node.type`, note it; Tasks 3 and 8 add those `case 'section':` arms. If a new error blocks the build here, add a temporary `case 'section': break;`/`return ''` to the flagged switch and record it — the real arm lands in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: section node type + sectionId membership field"
```

---

### Task 2: Label prefix `S` for sections

**Files:**
- Modify: `src/shared/nodeLabels.ts`
- Test: `test/node-labels.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/node-labels.mjs`:
```js
// - run: npx esbuild src/shared/nodeLabels.ts --bundle --format=esm --outfile=test/.build/node-labels.mjs && node --test test/node-labels.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nodeLabelPrefix, assignLabel } from './.build/node-labels.mjs';

test('section nodes get the S prefix', () => {
  assert.equal(nodeLabelPrefix({ type: 'section' }), 'S');
});

test('assignLabel gives the first free S-slot to a section', () => {
  const existing = [{ id: 'a', type: 'section', nodeLabel: 'S1' }];
  const out = assignLabel({ id: 'b', type: 'section' }, existing);
  assert.equal(out.nodeLabel, 'S2');
});

test('section labels do not collide with other prefixes', () => {
  const existing = [{ id: 'n', type: 'text', nodeLabel: 'N1' }];
  const out = assignLabel({ id: 's', type: 'section' }, existing);
  assert.equal(out.nodeLabel, 'S1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx esbuild src/shared/nodeLabels.ts --bundle --format=esm --outfile=test/.build/node-labels.mjs && node --test test/node-labels.mjs`
Expected: FAIL — first test gets `'X'` (the `default`) instead of `'S'`.

- [ ] **Step 3: Add the section case**

In `src/shared/nodeLabels.ts`, inside the `nodeLabelPrefix` switch, add before the `default:` line:
```ts
    case 'section': return 'S';
```
Also add a line to the prefix docstring at the top of the file (the block listing prefixes): `S — section container`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx esbuild src/shared/nodeLabels.ts --bundle --format=esm --outfile=test/.build/node-labels.mjs && node --test test/node-labels.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/nodeLabels.ts
git commit -m "feat: S label prefix for section nodes"
```

---

### Task 3: Migration — `wrapNodesInSection`

**Files:**
- Create: `src/shared/sections.ts`
- Test: `test/sections.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/sections.mjs`:
```js
// - run: npx esbuild src/shared/sections.ts --bundle --format=esm --outfile=test/.build/sections.mjs && node --test test/sections.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { wrapNodesInSection, SECTION_HEADER_H, SECTION_PAD } from './.build/sections.mjs';

test('wraps free nodes into one section and assigns sectionId', () => {
  const canvas = { nodes: [
    { id: 'a', type: 'text', x: 100, y: 200, width: 700, height: 300 },
    { id: 'b', type: 'text', x: 100, y: 600, width: 700, height: 300 },
  ], edges: [] };
  const out = wrapNodesInSection(canvas);
  const section = out.nodes.find(n => n.type === 'section');
  assert.ok(section, 'a section node was created');
  // - every non-section node now points at the section
  for (const n of out.nodes.filter(n => n.type !== 'section')) {
    assert.equal(n.sectionId, section.id);
  }
  // - the band encloses the content (min corner accounts for header + pad)
  assert.ok(section.x <= 100 - SECTION_PAD);
  assert.ok(section.y <= 200 - SECTION_HEADER_H);
  assert.ok(section.x + section.width  >= 800 + SECTION_PAD);
  assert.ok(section.y + section.height >= 900 + SECTION_PAD);
});

test('is idempotent — nodes already in a section are left as the same reference', () => {
  const canvas = { nodes: [
    { id: 's1', type: 'section', x: 0, y: 0, width: 900, height: 900 },
    { id: 'a', type: 'text', x: 100, y: 100, width: 700, height: 300, sectionId: 's1' },
  ], edges: [] };
  assert.equal(wrapNodesInSection(canvas), canvas);
});

test('leaves an empty canvas untouched', () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(wrapNodesInSection(canvas), canvas);
});

test('only wraps the nodes that lack a sectionId', () => {
  const canvas = { nodes: [
    { id: 's1', type: 'section', x: 0, y: 0, width: 100, height: 100 },
    { id: 'a', type: 'text', x: 50, y: 50, width: 10, height: 10, sectionId: 's1' },
    { id: 'b', type: 'text', x: 4000, y: 50, width: 10, height: 10 },
  ], edges: [] };
  const out = wrapNodesInSection(canvas);
  const sections = out.nodes.filter(n => n.type === 'section');
  assert.equal(sections.length, 2);                 // - the original + one new for the free node
  const b = out.nodes.find(n => n.id === 'b');
  assert.ok(b.sectionId && b.sectionId !== 's1');   // - b got the new section, not s1
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx esbuild src/shared/sections.ts --bundle --format=esm --outfile=test/.build/sections.mjs && node --test test/sections.mjs`
Expected: FAIL — esbuild "Could not resolve src/shared/sections.ts".

- [ ] **Step 3: Write the implementation**

Create `src/shared/sections.ts`:
```ts
/**
 * Section container helpers. A section is a band node that owns other nodes via their `sectionId`.
 * `wrapNodesInSection` migrates a legacy canvas (free nodes, no sections) so every node belongs to
 * a section — runs once on the host load path, after normalizeCanvasToOrigin. Pure; bundled into
 * both host and webview. No Node.js APIs.
 */

import type { CanvasData, CanvasNode, SectionNode } from './types';

// - screen-space header height and band padding (flow units at zoom 1)
export const SECTION_HEADER_H = 44;
export const SECTION_PAD = 40;

// - deterministic id from the min node so a re-migration of the same content is stable
function sectionIdFor(seedId: string): string {
  return `section-${seedId}`;
}

/**
 * Wrap every node that lacks a `sectionId` into a single new section sized to their bounding box.
 * Nodes already assigned to a section are untouched. Returns the same reference when nothing needs
 * wrapping (empty canvas, or all nodes already sectioned) so it triggers no save.
 */
export function wrapNodesInSection(canvas: CanvasData): CanvasData {
  const free = canvas.nodes.filter(n => n.type !== 'section' && !n.sectionId);
  if (free.length === 0) return canvas;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of free) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const seed = free.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
  const id = sectionIdFor(seed.id);
  const x = minX - SECTION_PAD;
  const y = minY - SECTION_HEADER_H;
  const section: SectionNode = {
    id,
    type: 'section',
    x,
    y,
    width: maxX + SECTION_PAD - x,
    height: maxY + SECTION_PAD - y,
    title: 'Section',
  };

  const freeIds = new Set(free.map(n => n.id));
  const nodes: CanvasNode[] = [
    section,
    ...canvas.nodes.map(n => (freeIds.has(n.id) ? { ...n, sectionId: id } : n)),
  ];
  return { ...canvas, nodes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx esbuild src/shared/sections.ts --bundle --format=esm --outfile=test/.build/sections.mjs && node --test test/sections.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sections.ts
git commit -m "feat: wrapNodesInSection migration for legacy canvases"
```

---

### Task 4: Apply the migration on the host load path

**Files:**
- Modify: `src/extension/editor-provider.ts`

- [ ] **Step 1: Add the import**

Near `import { normalizeCanvasToOrigin } from '../shared/bounds';`, add:
```ts
import { wrapNodesInSection } from '../shared/sections';
```

- [ ] **Step 2: Wrap on first load**

In the `webviewReady` handler, the normalize line (from Plan 1a) currently reads:
```ts
            const canvas = normalizeCanvasToOrigin(rawCanvas);
```
Change it to:
```ts
            const canvas = normalizeCanvasToOrigin(wrapNodesInSection(rawCanvas));
```

- [ ] **Step 3: Wrap on reload**

In `reloadFromDisk`, the line currently reads:
```ts
      const canvas = normalizeCanvasToOrigin(await readCanvas(document.uri.fsPath));
```
Change it to:
```ts
      const canvas = normalizeCanvasToOrigin(wrapNodesInSection(await readCanvas(document.uri.fsPath)));
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` → 3 baseline errors only.
Run: `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/extension/editor-provider.ts
git commit -m "feat: wrap legacy canvases into a section on open"
```

---

### Task 5: Section band component + registration

**Files:**
- Create: `src/webview/canvas/nodes/SectionNode.tsx`
- Modify: `src/webview/canvas/palette.ts`
- Modify: `src/webview/canvas/CanvasView.tsx`

- [ ] **Step 1: Add the section border color**

In `src/webview/canvas/palette.ts`, in the `DEFAULT_NODE_BORDER_BY_TYPE` object (lines ~18-29), add:
```ts
  section: 'rgba(83,223,221,0.35)',
```

- [ ] **Step 2: Create the band component**

Create `src/webview/canvas/nodes/SectionNode.tsx`:
```tsx
import React from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { SectionNode } from '../../../shared/types';
import { useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';

/**
 * SectionNode — a large kernel-tint-ready band that owns nodes (via their sectionId). Visual band
 * only; the interactive header (title / fold / delete) is a separate screen-space overlay
 * (SectionHeaders) so it never scales with zoom. Renders behind everything (zIndex set in toFlowNode).
 */
export function SectionNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as SectionNode;
  const accent = node.accentColor ?? undefined;
  const border = accent ?? DEFAULT_NODE_BORDER_BY_TYPE.section;
  const bg = accent ? `${accent}14` : 'rgba(83,223,221,0.05)';
  const bw = useZoomInvariantBorderWidth(1);
  return (
    <div style={{ width: '100%', height: '100%', border: `${bw}px solid ${border}`, borderRadius: 10, background: bg }}>
      <NodeResizer
        minWidth={240} minHeight={120}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Register the component**

In `src/webview/canvas/CanvasView.tsx`, add the import near the other node imports (~lines 44-53):
```tsx
import { SectionNodeComponent } from './nodes/SectionNode';
```
And add to the `NODE_TYPES` map (~lines 59-70):
```tsx
  section: SectionNodeComponent,
```

- [ ] **Step 4: Give the section band group-like flow behavior**

In `toFlowNode` (CanvasView.tsx ~lines 106-110), the current group special-case reads:
```tsx
    draggable:   cn.type !== 'group',
    selectable:  true,
    deletable:   true,
    zIndex:      cn.type === 'group' ? -1 : 0,
```
Change the two `group` checks so a `section` behaves the same (behind, non-draggable):
```tsx
    draggable:   cn.type !== 'group' && cn.type !== 'section',
    selectable:  true,
    deletable:   true,
    zIndex:      cn.type === 'group' || cn.type === 'section' ? -1 : 0,
```

- [ ] **Step 5: Treat sections like groups in the band-skip sites**

Several spots skip `group` nodes from snapping/nav/overlap/etc. Add a shared helper and use it. At the top of `CanvasView.tsx` module scope (near the other module-level consts, after `NODE_TYPES`), add:
```tsx
// - band-type nodes (group, section) are visual backdrops: skipped by snapping, nav, overlap checks
const isBandType = (t?: string): boolean => t === 'group' || t === 'section';
```
Then update each existing `type === 'group'` / `type !== 'group'` band-skip check to use it. The sites (match each by its current text; there are the group-skip checks at approximately these lines):
- `~273` helper-line loop: `if (other.id === node.id || other.type === 'group') continue;` → `if (other.id === node.id || isBandType(other.type)) continue;`
- `~345` `findFreePosition`: `if (n.type === 'group') return false;` → `if (isBandType(n.type)) return false;`
- `~932` nearest-after-delete: `if (deletedIds.has(n.id) || n.type === 'group') continue;` → `... || isBandType(n.type)) continue;`
- `~1162` `pickViewportNode`: `if (n.type === 'group') continue;` → `if (isBandType(n.type)) continue;`
- `~1576` directional-nav cone: `if (node.id === from.id || node.type === 'group') continue;` → `... || isBandType(node.type)) continue;`
- `~2259` viewport-snapshot: `if (cn.type === 'group') continue;` → `if (isBandType(cn.type)) continue;`
- `~1178` jumpToMark focus pick and the focused-node picks `n.selected && n.type !== 'group'` (there are several `n.type !== 'group'` focus picks — e.g. the `o` handler, Space, `c c`): change each `n.type !== 'group'` used to pick a *focusable* node to `!isBandType(n.type)` so a section band is never treated as the focused content node.

(Read the file and replace each occurrence; the intent is uniform: a section band is a backdrop, exactly like a group.)

- [ ] **Step 6: Build + typecheck**

Run: `npm run build` → clean.
Run: `npm run typecheck` → 3 baseline errors only.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/nodes/SectionNode.tsx src/webview/canvas/palette.ts src/webview/canvas/CanvasView.tsx
git commit -m "feat: section band component + group-like flow behavior"
```

---

### Task 6: Zoom-steady section header overlay (title · #S · fold · delete)

**Files:**
- Create: `src/webview/canvas/SectionHeaders.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx`

- [ ] **Step 1: Create the overlay**

Create `src/webview/canvas/SectionHeaders.tsx`:
```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_HEADER_H } from '../../shared/sections';

/**
 * Screen-space overlay that draws one fixed-size header bar per section, positioned by the live
 * React Flow transform (same technique as HelperLines) so it never scales with zoom. Owns the
 * fold ⌄ and delete ✕ controls and shows the title + #S address.
 */
export function SectionHeaders({ onFold, onDelete }: {
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const nodes = useStore(s => s.nodes);
  const sections = nodes.filter(n => n.type === 'section');

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {sections.map(s => {
        const d = s.data as { title?: string; nodeLabel?: string; folded?: boolean };
        const left = s.position.x * zoom + tx;
        const top = s.position.y * zoom + ty;
        const width = Math.max(Number(s.width ?? s.style?.width ?? 240) * zoom, 160);
        return (
          <div key={s.id} style={{
            position: 'absolute', left, top, width, height: SECTION_HEADER_H,
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
            pointerEvents: 'auto', boxSizing: 'border-box',
            background: 'var(--vscode-editor-background)', borderTopLeftRadius: 10, borderTopRightRadius: 10,
            borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--vscode-foreground)',
            fontSize: 13, overflow: 'hidden',
          }}>
            <button title="fold" onClick={() => onFold(s.id)} style={btn}>{d.folded ? '⌃' : '⌄'}</button>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {d.title ?? 'Section'}
            </span>
            <span style={{ opacity: 0.6, fontFamily: 'var(--vscode-editor-font-family)' }}>{d.nodeLabel ? `#${d.nodeLabel}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button title="delete section" onClick={() => onDelete(s.id)} style={btn}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
  fontSize: 14, lineHeight: 1, padding: 2,
};
```

- [ ] **Step 2: Mount the overlay inside `<ReactFlow>`**

In `CanvasView.tsx`, import it near the other canvas imports:
```tsx
import { SectionHeaders } from './SectionHeaders';
```
Inside the `<ReactFlow ...>...</ReactFlow>` children, next to `<HelperLines ... />` (the existing sibling overlay), add:
```tsx
        <SectionHeaders onFold={handleFoldSection} onDelete={handleDeleteSection} />
```
(The two handlers are defined in Tasks 7 and 8's steps below — add this line together with those handlers so the build stays green; if executing this task first, add temporary no-op `const handleFoldSection = useCallback((_id: string) => {}, []);` and `const handleDeleteSection = useCallback((_id: string) => {}, []);` and replace them in Tasks 7/8.)

- [ ] **Step 3: Build**

Run: `npm run build` → clean. Run `npm run typecheck` → 3 baseline only.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/SectionHeaders.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat: zoom-steady section header overlay"
```

---

### Task 7: Fold — collapse a section to its header

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx`

- [ ] **Step 1: Implement `handleFoldSection`**

In `CanvasView.tsx`, replace the temporary `handleFoldSection` (or add it near the other `useCallback` handlers) with:
```tsx
  // - fold/unfold a section: hide its member nodes and collapse the band to the header height
  const handleFoldSection = useCallback((sectionId: string) => {
    const section = canvasRef.current.nodes.find(n => n.id === sectionId && n.type === 'section');
    if (!section) return;
    const folding = !(section as { folded?: boolean }).folded;
    pushHistory();
    const memberIds = new Set(canvasRef.current.nodes.filter(n => n.sectionId === sectionId).map(n => n.id));
    // - remember the expanded height so unfolding restores it
    const fullH = folding ? section.height : (section as { _fullH?: number })._fullH ?? section.height;
    setNodes(nds => nds.map(n => {
      if (n.id === sectionId) {
        return { ...n, hidden: false, height: folding ? SECTION_HEADER_H : fullH,
          style: { ...n.style, height: folding ? SECTION_HEADER_H : fullH },
          data: { ...n.data, folded: folding } };
      }
      if (memberIds.has(n.id)) return { ...n, hidden: folding };
      return n;
    }));
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n => {
        if (n.id === sectionId) return { ...n, folded: folding, height: folding ? SECTION_HEADER_H : fullH, _fullH: folding ? section.height : undefined } as CanvasNode;
        return n;
      }),
    };
    scheduleSave();
  }, [pushHistory, setNodes, scheduleSave]);
```
Import `SECTION_HEADER_H` at the top of `CanvasView.tsx`:
```tsx
import { SECTION_HEADER_H } from '../../shared/sections';
```

- [ ] **Step 2: Build + manual reasoning check**

Run: `npm run build` → clean. Run `npm run typecheck` → 3 baseline only (the `_fullH` cast keeps the extra field off the persisted type; it is a transient UI field — acceptable, or move `_fullH` onto `SectionNode` as an optional field if the cast is undesirable).

- [ ] **Step 3: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat: fold a section (hide members, collapse to header)"
```

---

### Task 8: Delete a section + New-Section command + host type registration

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx`, `src/shared/types.ts` (message), `src/extension/editor-provider.ts`, `package.json`, `src/extension/mcp/server.ts`, `src/extension/context-builder.ts`, `src/webview/canvas/searchMatch.ts`, `src/webview/canvas/MarksPanel.tsx`

- [ ] **Step 1: Implement `handleDeleteSection` (delete band + members, via the existing confirm path)**

In `CanvasView.tsx`, replace the temporary `handleDeleteSection` with:
```tsx
  // - delete a whole section: the band plus every node it owns (undo-able via pushHistory)
  const handleDeleteSection = useCallback((sectionId: string) => {
    const section = canvasRef.current.nodes.find(n => n.id === sectionId && n.type === 'section');
    if (!section) return;
    const members = canvasRef.current.nodes.filter(n => n.sectionId === sectionId || n.id === sectionId);
    performDelete(members.map(toFlowNode));
  }, [performDelete]);
```
(`performDelete` is the existing delete routine used by `dd`/`xx`; it handles confirm for active kernels, edge cleanup, focus, and persistence. `toFlowNode` is the existing converter.)

**Caution (Task 5 fix interaction):** sections are now `deletable: false` in `toFlowNode` (Task 5 follow-up, to stop the native Delete key from removing a band and orphaning its members). `deletable` only gates React Flow's own Delete-key/`onNodesDelete` path — `performDelete` operates on an explicit node list, so it should still remove the passed section. **Verify** the section node is actually gone after `handleDeleteSection` (open the file, check `performDelete` doesn't re-filter by `deletable`); if it does skip non-deletable nodes, remove the section by direct state update (`setNodes`/`canvasRef` filter) instead so the band is truly deleted.

- [ ] **Step 2: Add the `newSection` message type**

In `src/shared/types.ts`, add near the other Webview→Host messages:
```ts
export interface MsgNewSection { type: 'newSection'; }
```
Add `MsgNewSection` to the `WebviewToHost` union. And a Host→Webview trigger:
```ts
export interface MsgNewSectionTrigger { type: 'newSectionTrigger'; }
```
Add `MsgNewSectionTrigger` to the `HostToWebview` union.

- [ ] **Step 3: Add the webview handler that creates an empty section**

In `CanvasView.tsx`, add a listener that appends a new empty section below the lowest existing section, at the origin column, then labels + persists it:
```tsx
  // - create a new empty section stacked below the last one (append-only), at the origin column
  const handleNewSection = useCallback(() => {
    const secs = canvasRef.current.nodes.filter(n => n.type === 'section');
    const bottom = secs.length ? Math.max(...secs.map(s => s.y + s.height)) : 0;
    const raw: CanvasNode = {
      id: `section-${Date.now()}`, type: 'section',
      x: ORIGIN_GUTTER, y: bottom + NEW_NODE.gap + SECTION_HEADER_H,
      width: NEW_NODE.w + 2 * 40, height: 300, title: 'Section',
    } as CanvasNode;
    const labeled = assignLabel(raw, canvasRef.current.nodes);
    const nextIdx = (canvasRef.current.creationCounter ?? 0) + 1;
    pushHistory();
    const withIdx = { ...labeled, creationIndex: nextIdx } as CanvasNode;
    setNodes(nds => [...nds, toFlowNode(withIdx)]);
    canvasRef.current = { ...canvasRef.current, creationCounter: nextIdx, nodes: [...canvasRef.current.nodes, withIdx] };
    scheduleSave();
  }, [pushHistory, setNodes, scheduleSave]);

  useEffect(() => {
    const h = () => handleNewSection();
    window.addEventListener('skena:newSection', h);
    return () => window.removeEventListener('skena:newSection', h);
  }, [handleNewSection]);
```
(`assignLabel` is already imported for other creation paths; `ORIGIN_GUTTER` and `NEW_NODE` are already imported; `SECTION_HEADER_H` imported in Task 7.)

- [ ] **Step 4: Relay the command host→webview**

In `App.tsx`, in the message switch, add a case that re-broadcasts the trigger as a window event (mirror how `addKernelTrigger`/`addNodeTrigger` are relayed):
```tsx
        case 'newSectionTrigger':
          window.dispatchEvent(new CustomEvent('skena:newSection'));
          break;
```

- [ ] **Step 5: Register the VS Code command**

In `src/extension/editor-provider.ts`, register a `skena.newSection` command that posts `newSectionTrigger` to the active panel (mirror the existing `skena.addKernel`/add-node command registration). In the command body, resolve the active panel from `SkenaEditorProvider.panelsByPath` (as the kernel command does) and `panel.webview.postMessage({ type: 'newSectionTrigger' })`.
In `package.json`, add to `contributes.commands`:
```json
{ "command": "skena.newSection", "title": "Skena: New Section" }
```

- [ ] **Step 6: Register `section` at the host dispatch sites**

- `src/extension/mcp/server.ts`:
  - `nodeSnippet` switch (~252-263): `case 'section': return node.title ? \`section "${node.title}"\` : '(section)';`
  - detail-view switch (~438-448): `case 'section': content = \`Section: ${n.title ?? '(untitled)'}\`; break;`
  - `canvasSearch` haystack (~471-478): add `n.type === 'section' ? (n.title ?? '') : ''` to the joined text.
- `src/extension/context-builder.ts`:
  - `nodeTitle` switch (~158-170): `case 'section': return node.title ?? 'section';`
- `src/webview/canvas/searchMatch.ts` (~37-46): add `case 'section': return node.title ?? '';` (match the existing per-type return shape).
- `src/webview/canvas/MarksPanel.tsx` (~16-28): add a `section` icon entry (reuse the group/`symbol-namespace` codicon or any existing icon string used there).

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck` → 3 baseline errors only (the union-exhaustiveness gaps from Task 1 should now be closed).
Run: `npm run build` → clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: delete section, New Section command, register section type across dispatch sites"
```

---

### Task 9: Live smoke (manual — needs the dev host)

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build` → clean. (Reload the Extension Development Host window to pick it up.)

- [ ] **Step 2: Migration**

Open `research/loe/live-slippage.canvas` (or any legacy canvas). Expected: existing nodes are now enclosed in a section band with a header bar (title + `#S1`), positioned at the top-left; nodes keep their relative layout.

- [ ] **Step 3: New Section**

Run the command palette → "Skena: New Section". Expected: a new empty band appears stacked below the existing content at the origin column, with a `#S2` header.

- [ ] **Step 4: Fold**

Click the header ⌄. Expected: the section's member nodes hide and the band collapses to the header bar; ⌃ unfolds and restores them.

- [ ] **Step 5: Delete**

Click the header ✕. Expected: the section and all its member nodes are removed (confirm dialog if a member is an active kernel); `u` undoes it.

- [ ] **Step 6: Zoom-steady header + `#S` address**

Zoom in/out. Expected: the header bar keeps its on-screen size (never scales). From another canvas, a `<path>.canvas#S1` reference opens this canvas and centers section S1.

---

## Self-Review

**Spec coverage (§3 Section, §7 Sections stack/create/move):**
- §3 new section node type, kernel-tint-ready band: Tasks 1, 5.
- §3 zoom-steady header (fold · title · `#S` · delete): Tasks 6, 7, 8. (Creation-time + kernel LED in the header: kernel LED is Phase 2; creation time is a small add — deferred, noted below.)
- §3 `#S` addressability (`<file>.canvas#S3`): works via the existing label-resolution path (regex already multi-letter, resolve-by-`nodeLabel`) once the section is a labeled node — Tasks 2, 8; verified in Task 9 Step 6.
- §3 foldable + deletable: Tasks 7, 8.
- §7 everything belongs to a section (migration): Tasks 3, 4.
- §7 stacked vertically, append-only; New Section: Task 8.
- **Deferred (out of 1b scope, noted in the header):** many-sections→one-kernel shared tint + kernel LED (Phase 2 — kernel-as-section-attribute); move nodes between sections + drop-doc→section (a later plan); the packing engine / reflow inside a section (Plan 1c); the header's creation-time stamp (small, fold into 1c or a polish pass). **Phase-2 gotcha (found in Task 5 review):** `toFlowNode` unconditionally overwrites each node's `accentColor` from the generic JSON-Canvas `color` field, so a `SectionNode`'s own persisted `accentColor` never reaches the render — Phase 2's kernel-tint must special-case `toFlowNode` for sections or the tint will silently do nothing.

**Placeholder scan:** the only forward references are the two header handlers in Task 6 (created as temporary no-ops there, implemented in Tasks 7/8) — called out explicitly with the temporary code, not left blank. Task 5 Step 5 asks the implementer to replace each band-skip site by matching current text (the sites are enumerated with line hints + the exact before→after); acceptable because the edits are uniform and the file drifts during execution.

**Type consistency:** `SectionNode` (`type:'section'`, `title?`, `folded?`, `accentColor?`), `sectionId?` on `CanvasNodeBase`, `SECTION_HEADER_H`/`SECTION_PAD`/`wrapNodesInSection` from `src/shared/sections.ts`, and `nodeLabelPrefix('section') → 'S'` are used consistently across the tasks. The transient `_fullH` fold field is cast (Task 7) — flagged there with the option to promote it to `SectionNode` if the cast is unwanted.

**Open call for the reviewer/user:** Task 8 makes **delete-section destroy its member nodes** (undo-able). The alternative — orphan members (drop their `sectionId`) — would violate "everything belongs to a section" until the next migration re-wraps them. Confirm delete-with-members is the intended semantic before executing Task 8.
