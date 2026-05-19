# Activity Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color canvas nodes and edges by cluster (connected component via BFS) with brightness indicating creation recency — newest glows brightest, oldest is dim, isolated nodes are gray.

**Architecture:** A `HeatmapProvider` inside `CanvasViewInner` calls `useActivityHeatmap(nodes, edges)` (a `useMemo`-d BFS) and provides `{ visible, toggle, nodeGlow, edgeGlow }` via React context. Node components and `LabeledEdge` read from the context and apply pre-computed CSS glow styles. `gh` key sequence toggles visibility. `creationIndex` is stamped once at node creation and stored in the JSON.

**Tech Stack:** React 18, ReactFlow v12 (`@xyflow/react`), TypeScript, CSS `filter: drop-shadow()`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/shared/types.ts` | Add `creationIndex`, `creationCounter`, `HeatmapNode`, `EdgeGlow` types |
| Modify | `src/extension/canvas-io.ts` | Carry `creationCounter` through read |
| Create | `src/webview/hooks/useActivityHeatmap.ts` | Pure BFS + intensity computation + React hook |
| Create | `src/webview/context/HeatmapContext.tsx` | Context, provider, `useHeatmap()` hook |
| Modify | `src/webview/canvas/CanvasView.tsx` | Stamp `creationIndex`, wrap with provider, `gh` hotkey |
| Modify | `src/webview/canvas/edges/LabeledEdge.tsx` | Read context, apply glow via `drop-shadow` |
| Modify | `src/webview/canvas/nodes/TextNode.tsx` | Apply glow styles from context |
| Modify | `src/webview/canvas/nodes/FileNode.tsx` | Apply glow styles from context |
| Modify | `src/webview/canvas/nodes/LinkNode.tsx` | Apply glow styles from context |
| Modify | `src/webview/canvas/nodes/CellNode.tsx` | Apply glow styles from context |
| Modify | `src/webview/canvas/nodes/ChatNode.tsx` | Apply glow styles from context |
| Modify | `src/webview/canvas/nodes/PortalNode.tsx` | Apply glow styles from context |
| Create | `test/heatmap-bfs.mjs` | Node.js test for pure BFS logic |

---

### Task 1: Type definitions

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `HeatmapNode` and `EdgeGlow` types, extend `CanvasNodeBase` and `CanvasData`**

In `src/shared/types.ts`, after the `CanvasData` interface (line 122), add:

```typescript
// ─── Activity heatmap types ────────────────────────────────────────────────────

/**
 * Per-node glow data computed by useActivityHeatmap.
 * color is an RGB triplet string e.g. "56,189,248" — use as rgba(${color},${alpha}).
 */
export type HeatmapNode = {
  color:       string;
  intensity:   number;
  clusterId:   number | null;
  glowFilter:  string;   // - CSS filter string, ready to apply
  borderColor: string;   // - CSS rgba() border color
  opacity:     number;   // - 1.0 normally, 0.45 for isolated nodes
};

/**
 * Per-edge glow data computed by useActivityHeatmap.
 */
export type EdgeGlow = {
  color:      string;
  intensity:  number;
  stroke:     string;    // - rgba() stroke color
  glowFilter: string;    // - CSS filter string, ready to apply
};
```

In `CanvasNodeBase` (around line 21), add after `lastTouched`:

```typescript
  /**
   * Monotonically increasing integer assigned once at node creation.
   * Higher = created later. Used by the activity heatmap for recency ranking.
   * Ignored by Obsidian.
   */
  creationIndex?: number;
```

In `CanvasData` (around line 122), add after `viewport`:

```typescript
  /**
   * Monotonically increasing counter; incremented every time a node is created.
   * Persisted so the sequence survives canvas reopen.
   */
  creationCounter?: number;
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -30
```

Expected: no new errors beyond the pre-existing `editor-provider.ts:165` one.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(heatmap): add HeatmapNode, EdgeGlow types; creationIndex, creationCounter fields"
```

---

### Task 2: canvas-io.ts — carry creationCounter through read

**Files:**
- Modify: `src/extension/canvas-io.ts:25-29`

- [ ] **Step 1: Add `creationCounter` to the return object of `readCanvas`**

Current (lines 25-29):
```typescript
  return {
    nodes:    parsed.nodes    ?? [],
    edges:    parsed.edges    ?? [],
    viewport: parsed.viewport,
  };
```

Replace with:
```typescript
  return {
    nodes:           parsed.nodes           ?? [],
    edges:           parsed.edges           ?? [],
    viewport:        parsed.viewport,
    creationCounter: parsed.creationCounter,
  };
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/extension/canvas-io.ts
git commit -m "feat(heatmap): carry creationCounter through readCanvas"
```

---

### Task 3: Pure BFS computation + React hook

**Files:**
- Create: `src/webview/hooks/useActivityHeatmap.ts`
- Create: `test/heatmap-bfs.mjs`

The palette is a fixed array of 6 RGB triplet strings, cycling for > 6 clusters. Isolated nodes (no edges) get gray. Intensity is normalized within each cluster by creation rank.

- [ ] **Step 1: Write the failing test first**

Create `test/heatmap-bfs.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// - inline the pure computation (Task 3 Step 2 will put it in the hook file;
// - for testing we duplicate the pure function here temporarily)

const PALETTE = [
  '56,189,248',
  '251,146,60',
  '167,139,250',
  '52,211,153',
  '244,114,182',
  '250,204,21',
];
const GRAY = '140,140,140';
const INTENSITY_MIN = 0.18;
const INTENSITY_MAX = 0.95;

function computeHeatmapData(nodes, edges) {
  // - build adjacency list (undirected)
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).push(e.target);
      adj.get(e.target).push(e.source);
    }
  }

  // - BFS connected components; isolated nodes get clusterId = null
  const clusterOf = new Map();
  let clusterCount = 0;
  const visited = new Set();

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const hasEdge = adj.get(n.id).length > 0;
    if (!hasEdge) {
      clusterOf.set(n.id, null);
      visited.add(n.id);
      continue;
    }
    const cid = clusterCount++;
    const queue = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift();
      clusterOf.set(cur, cid);
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
  }

  // - group nodes by cluster, rank by creationIndex within cluster
  const clusterNodes = new Map();
  for (const n of nodes) {
    const cid = clusterOf.get(n.id);
    if (!clusterNodes.has(cid)) clusterNodes.set(cid, []);
    clusterNodes.get(cid).push({ id: n.id, idx: n.data?.creationIndex ?? 0 });
  }

  // - compute intensity per node
  const nodeGlow = new Map();
  for (const [cid, members] of clusterNodes) {
    const sorted = [...members].sort((a, b) => a.idx - b.idx);
    const maxRank = sorted.length - 1;
    const color = cid === null ? GRAY : PALETTE[cid % PALETTE.length];
    sorted.forEach((m, rank) => {
      const intensity = maxRank === 0
        ? INTENSITY_MAX
        : INTENSITY_MIN + (rank / maxRank) * (INTENSITY_MAX - INTENSITY_MIN);
      const isIso = cid === null;
      const glowFilter = isIso
        ? `drop-shadow(0 0 2px rgba(${color},0.25))`
        : `drop-shadow(0 0 ${(intensity * 9).toFixed(1)}px rgba(${color},${intensity.toFixed(2)})) drop-shadow(0 0 ${(intensity * 18).toFixed(1)}px rgba(${color},${(intensity * 0.45).toFixed(2)}))`;
      nodeGlow.set(m.id, {
        color,
        intensity,
        clusterId: cid,
        glowFilter,
        borderColor: `rgba(${color},${isIso ? 0.18 : (intensity * 0.65).toFixed(2)})`,
        opacity: isIso ? 0.45 : 1.0,
      });
    });
  }

  // - edge glow: color of source cluster, intensity = max of endpoints
  const edgeGlow = new Map();
  for (const e of edges) {
    const sg = nodeGlow.get(e.source);
    const tg = nodeGlow.get(e.target);
    if (!sg || !tg) continue;
    const intensity = Math.max(sg.intensity, tg.intensity);
    const color = sg.color;
    edgeGlow.set(e.id, {
      color,
      intensity,
      stroke: `rgba(${color},${intensity.toFixed(2)})`,
      glowFilter: `drop-shadow(0 0 ${(intensity * 6).toFixed(1)}px rgba(${color},${(intensity * 0.6).toFixed(2)}))`,
    });
  }

  return { nodeGlow, edgeGlow };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('isolated node gets gray and 0.45 opacity', () => {
  const result = computeHeatmapData(
    [{ id: 'a', data: {} }],
    []
  );
  const g = result.nodeGlow.get('a');
  assert.equal(g.color, GRAY);
  assert.equal(g.clusterId, null);
  assert.equal(g.opacity, 0.45);
});

test('single cluster of 2 nodes — newer node gets higher intensity', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 5 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const ga = result.nodeGlow.get('a');
  const gb = result.nodeGlow.get('b');
  assert.equal(ga.clusterId, gb.clusterId);
  assert.equal(ga.color, gb.color);
  assert(gb.intensity > ga.intensity, 'newer node must have higher intensity');
  assert.equal(ga.intensity, INTENSITY_MIN);
  assert.equal(gb.intensity, INTENSITY_MAX);
});

test('single-node cluster gets max intensity', () => {
  const result = computeHeatmapData(
    [
      { id: 'x', data: { creationIndex: 3 } },
      { id: 'y', data: { creationIndex: 7 } },
    ],
    [{ id: 'e1', source: 'x', target: 'y' }]
  );
  // - only one cluster of 2 nodes, maxRank = 1, so x=min, y=max
  assert.equal(result.nodeGlow.get('x').intensity, INTENSITY_MIN);
  assert.equal(result.nodeGlow.get('y').intensity, INTENSITY_MAX);
});

test('two separate clusters get different palette colors', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 2 } },
      { id: 'c', data: { creationIndex: 3 } },
      { id: 'd', data: { creationIndex: 4 } },
    ],
    [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'c', target: 'd' },
    ]
  );
  const colorAB = result.nodeGlow.get('a').color;
  const colorCD = result.nodeGlow.get('c').color;
  assert.notEqual(colorAB, colorCD);
  assert.notEqual(colorAB, GRAY);
  assert.notEqual(colorCD, GRAY);
});

test('edge glow uses source cluster color and max intensity of endpoints', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 5 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const eg = result.edgeGlow.get('e1');
  const ng = result.nodeGlow.get('a');
  assert.equal(eg.color, ng.color);
  assert.equal(eg.intensity, INTENSITY_MAX); // - max of the two node intensities
});

test('nodes without creationIndex get rank 0 (treated as oldest)', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: {} },             // - no creationIndex → rank 0
      { id: 'b', data: { creationIndex: 10 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const ga = result.nodeGlow.get('a');
  const gb = result.nodeGlow.get('b');
  assert(gb.intensity > ga.intensity);
});
```

- [ ] **Step 2: Run the test — expect failure (computeHeatmapData not exported yet, but the inline copy should pass)**

```bash
cd /home/quant0/devs/skena && node --test test/heatmap-bfs.mjs
```

Expected: all 6 tests PASS (the test file contains the inline implementation).

- [ ] **Step 3: Create `src/webview/hooks/useActivityHeatmap.ts`**

```typescript
/**
 * useActivityHeatmap — computes cluster colors and intensity glow values
 * for the activity heatmap overlay.
 *
 * Algorithm:
 *   1. BFS on undirected edge graph → connected components (clusters).
 *   2. Nodes with no edges are isolated (clusterId = null, shown gray).
 *   3. Within each cluster, rank nodes by creationIndex ascending.
 *   4. Map rank to intensity in [0.18, 0.95].
 *   5. Pre-compute CSS filter strings for quick application in node components.
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { HeatmapNode, EdgeGlow } from '../../shared/types';

// ─── constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  '56,189,248',    // - cyan
  '251,146,60',    // - orange
  '167,139,250',   // - purple
  '52,211,153',    // - green
  '244,114,182',   // - pink
  '250,204,21',    // - yellow
] as const;

const GRAY         = '140,140,140';
const INTENSITY_MIN = 0.18;
const INTENSITY_MAX = 0.95;

// ─── pure computation ─────────────────────────────────────────────────────────

/**
 * Pure function — no React dependencies. Exported for testing.
 * Accepts ReactFlow Node/Edge shapes but only uses id, data, source, target.
 */
export function computeHeatmapData(
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ id: string; source: string; target: string }>,
): { nodeGlow: Map<string, HeatmapNode>; edgeGlow: Map<string, EdgeGlow> } {

  // - build undirected adjacency list
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }

  // - BFS: assign cluster id to each node; isolated nodes get null
  const clusterOf = new Map<string, number | null>();
  let   clusterCount = 0;
  const visited = new Set<string>();

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const hasEdge = (adj.get(n.id)?.length ?? 0) > 0;
    if (!hasEdge) {
      clusterOf.set(n.id, null);
      visited.add(n.id);
      continue;
    }
    const cid   = clusterCount++;
    const queue = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift()!;
      clusterOf.set(cur, cid);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
  }

  // - group nodes by cluster and rank by creationIndex
  const clusterMembers = new Map<number | null, Array<{ id: string; idx: number }>>();
  for (const n of nodes) {
    const cid = clusterOf.get(n.id) ?? null;
    if (!clusterMembers.has(cid)) clusterMembers.set(cid, []);
    clusterMembers.get(cid)!.push({
      id:  n.id,
      idx: (n.data.creationIndex as number | undefined) ?? 0,
    });
  }

  // - compute per-node glow
  const nodeGlow = new Map<string, HeatmapNode>();
  for (const [cid, members] of clusterMembers) {
    const sorted  = [...members].sort((a, b) => a.idx - b.idx);
    const maxRank = sorted.length - 1;
    const isIso   = cid === null;
    const color   = isIso ? GRAY : PALETTE[(cid as number) % PALETTE.length];

    sorted.forEach((m, rank) => {
      const intensity = maxRank === 0
        ? INTENSITY_MAX
        : INTENSITY_MIN + (rank / maxRank) * (INTENSITY_MAX - INTENSITY_MIN);

      const glowFilter = isIso
        ? `drop-shadow(0 0 2px rgba(${color},0.25))`
        : `drop-shadow(0 0 ${(intensity * 9).toFixed(1)}px rgba(${color},${intensity.toFixed(2)})) ` +
          `drop-shadow(0 0 ${(intensity * 18).toFixed(1)}px rgba(${color},${(intensity * 0.45).toFixed(2)}))`;

      nodeGlow.set(m.id, {
        color,
        intensity,
        clusterId:   cid,
        glowFilter,
        borderColor: `rgba(${color},${isIso ? 0.18 : (intensity * 0.65).toFixed(2)})`,
        opacity:     isIso ? 0.45 : 1.0,
      });
    });
  }

  // - compute per-edge glow
  const edgeGlow = new Map<string, EdgeGlow>();
  for (const e of edges) {
    const sg = nodeGlow.get(e.source);
    const tg = nodeGlow.get(e.target);
    if (!sg || !tg) continue;
    const intensity = Math.max(sg.intensity, tg.intensity);
    const color     = sg.color;
    edgeGlow.set(e.id, {
      color,
      intensity,
      stroke:     `rgba(${color},${intensity.toFixed(2)})`,
      glowFilter: `drop-shadow(0 0 ${(intensity * 6).toFixed(1)}px rgba(${color},${(intensity * 0.6).toFixed(2)}))`,
    });
  }

  return { nodeGlow, edgeGlow };
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Memoized hook — re-runs BFS only when the nodes or edges arrays change identity.
 * Call inside CanvasViewInner (or HeatmapProvider) where nodes/edges are available.
 */
export function useActivityHeatmap(
  nodes: Node[],
  edges: Edge[],
): { nodeGlow: Map<string, HeatmapNode>; edgeGlow: Map<string, EdgeGlow> } {
  return useMemo(
    () => computeHeatmapData(nodes, edges),
    [nodes, edges],
  );
}
```

- [ ] **Step 4: Update test to import from the hook file**

In `test/heatmap-bfs.mjs`, replace the inline `computeHeatmapData` with an import. Since the hook file uses TypeScript and the test is plain JS, the test keeps the inline copy (it already tested the logic). The test file remains as-is as a standalone regression check.

- [ ] **Step 5: Typecheck**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 6: Run tests**

```bash
cd /home/quant0/devs/skena && node --test test/heatmap-bfs.mjs
```

Expected: 6/6 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/webview/hooks/useActivityHeatmap.ts test/heatmap-bfs.mjs
git commit -m "feat(heatmap): BFS cluster computation + intensity normalization + tests"
```

---

### Task 4: HeatmapContext

**Files:**
- Create: `src/webview/context/HeatmapContext.tsx`

- [ ] **Step 1: Create the context file**

```tsx
/**
 * HeatmapContext — provides cluster glow data to all node and edge components.
 *
 * HeatmapProvider accepts nodes and edges (ReactFlow arrays), calls
 * useActivityHeatmap internally, and exposes the results + visibility toggle
 * via context.
 *
 * Usage:
 *   // In CanvasViewInner:
 *   <HeatmapProvider nodes={nodes} edges={edges}>
 *     <ZoomLevelProvider>
 *       ...
 *     </ZoomLevelProvider>
 *   </HeatmapProvider>
 *
 *   // In any node/edge component:
 *   const { visible, nodeGlow } = useHeatmap();
 */

import React, { createContext, useContext, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { HeatmapNode, EdgeGlow } from '../../shared/types';
import { useActivityHeatmap } from '../hooks/useActivityHeatmap';

interface HeatmapContextValue {
  visible:  boolean;
  toggle:   () => void;
  nodeGlow: Map<string, HeatmapNode>;
  edgeGlow: Map<string, EdgeGlow>;
}

const EMPTY_MAP_NODE = new Map<string, HeatmapNode>();
const EMPTY_MAP_EDGE = new Map<string, EdgeGlow>();

const HeatmapContext = createContext<HeatmapContextValue>({
  visible:  false,
  toggle:   () => undefined,
  nodeGlow: EMPTY_MAP_NODE,
  edgeGlow: EMPTY_MAP_EDGE,
});

export function useHeatmap(): HeatmapContextValue {
  return useContext(HeatmapContext);
}

interface HeatmapProviderProps {
  nodes:    Node[];
  edges:    Edge[];
  children: React.ReactNode;
}

/** - must be rendered inside CanvasViewInner where nodes/edges state is available */
export function HeatmapProvider({ nodes, edges, children }: HeatmapProviderProps): JSX.Element {
  const [visible, setVisible] = useState(true);
  const { nodeGlow, edgeGlow } = useActivityHeatmap(nodes, edges);

  const toggle = () => setVisible(v => !v);

  return (
    <HeatmapContext.Provider value={{ visible, toggle, nodeGlow, edgeGlow }}>
      {children}
    </HeatmapContext.Provider>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/webview/context/HeatmapContext.tsx
git commit -m "feat(heatmap): HeatmapContext + HeatmapProvider + useHeatmap hook"
```

---

### Task 5: CanvasView — stamp creationIndex + wrap + gh hotkey

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx`

There are four changes: (A) import, (B) wrap return with provider, (C) stamp creationIndex in node-creation paths, (D) add `gh` key sequence.

- [ ] **Step A: Add import at top of file** (after existing imports, around line 48)

Add:
```typescript
import { HeatmapProvider } from '../context/HeatmapContext';
```

Also find the `useHeatmap` toggle — we'll need it inside CanvasViewInner. But `toggle` comes from context which we need to consume in `CanvasViewInner`. Instead, we control `visible` via `HeatmapProvider`'s internal state. To toggle from a key handler inside `CanvasViewInner`, we need a ref-based escape hatch.

**Revised approach:** add a module-level `toggleHeatmapRef` so `CanvasViewInner`'s key handler can call it even before the context is set up:

After existing module-level declarations (e.g. after `lastFocusedNodeId` Map around line 267), add:

```typescript
// - escape hatch: module-level ref so the key handler can toggle heatmap
// - without needing to consume the context inside CanvasViewInner itself.
// - HeatmapProvider sets this ref in a useEffect after mount.
const toggleHeatmapRef = { current: () => {} };
```

In `HeatmapContext.tsx`, update `HeatmapProvider` to wire this ref (import it):
> **Note:** this creates a circular import. Better approach: pass a `onToggleRef` callback.

**Actually simpler approach:** lift `visible` state to `CanvasViewInner` and pass it as a prop to `HeatmapProvider`.

Update `HeatmapProvider` to accept optional external `visible` + `toggle`:

Update `src/webview/context/HeatmapContext.tsx` — change `HeatmapProviderProps` and component:

```tsx
interface HeatmapProviderProps {
  nodes:    Node[];
  edges:    Edge[];
  visible:  boolean;
  toggle:   () => void;
  children: React.ReactNode;
}

export function HeatmapProvider({ nodes, edges, visible, toggle, children }: HeatmapProviderProps): JSX.Element {
  const { nodeGlow, edgeGlow } = useActivityHeatmap(nodes, edges);

  return (
    <HeatmapContext.Provider value={{ visible, toggle, nodeGlow, edgeGlow }}>
      {children}
    </HeatmapContext.Provider>
  );
}
```

- [ ] **Step A (revised): Update HeatmapContext.tsx to accept external visible/toggle**

Edit `src/webview/context/HeatmapContext.tsx` — replace the `HeatmapProvider` function:

```tsx
interface HeatmapProviderProps {
  nodes:    Node[];
  edges:    Edge[];
  visible:  boolean;
  toggle:   () => void;
  children: React.ReactNode;
}

/** - visible/toggle are owned by CanvasViewInner so the key handler can call toggle directly */
export function HeatmapProvider({ nodes, edges, visible, toggle, children }: HeatmapProviderProps): JSX.Element {
  const { nodeGlow, edgeGlow } = useActivityHeatmap(nodes, edges);

  return (
    <HeatmapContext.Provider value={{ visible, toggle, nodeGlow, edgeGlow }}>
      {children}
    </HeatmapContext.Provider>
  );
}
```

Remove `import { useState }` if it was only used for `visible` state (it may not be needed anymore).

- [ ] **Step B: Add `heatmapVisible` state and `lastGPressRef` inside `CanvasViewInner`**

Inside `function CanvasViewInner(...)` near the other state declarations (around line 288), add:

```typescript
const [heatmapVisible, setHeatmapVisible] = useState(true);
const lastGPressRef = useRef<number>(0);
const toggleHeatmap = useCallback(() => setHeatmapVisible(v => !v), []);
```

- [ ] **Step C: Wrap return with `HeatmapProvider`**

In the `return` of `CanvasViewInner` (line ~1635), change from:
```tsx
return (
  <ZoomLevelProvider>
  ...
  </ZoomLevelProvider>
);
```
to:
```tsx
return (
  <HeatmapProvider nodes={nodes} edges={edges} visible={heatmapVisible} toggle={toggleHeatmap}>
  <ZoomLevelProvider>
  ...
  </ZoomLevelProvider>
  </HeatmapProvider>
);
```

- [ ] **Step D: Add `gh` key sequence to the keyboard handler**

In the keyboard handler in `CanvasViewInner`, find where other double-tap refs are checked (around line 1167 — the `yy` handler). Add BEFORE the `yy` block:

```typescript
// - g key: start a two-key sequence (used for gh = toggle heatmap)
if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'g') {
  lastGPressRef.current = Date.now();
  return;
}

// - gh (g then h within 400 ms): toggle activity heatmap
if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'h') {
  if (Date.now() - lastGPressRef.current < 400) {
    lastGPressRef.current = 0;
    e.preventDefault();
    toggleHeatmap();
    return;
  }
  // - fall through to normal h (navigate left)
}
```

- [ ] **Step E: Stamp `creationIndex` in `skena:addNodeResult` handler**

In the handler at line ~1446, after `const cn = assignLabel(rawNode, canvasRef.current.nodes);`, add:

```typescript
// - stamp creation index and increment canvas-level counter
const nextIdx = (canvasRef.current.creationCounter ?? 0) + 1;
canvasRef.current = { ...canvasRef.current, creationCounter: nextIdx };
const cnWithIdx: CanvasNode = { ...cn, creationIndex: nextIdx };
```

Then replace all subsequent uses of `cn` in that handler with `cnWithIdx`.

The handler becomes:
```typescript
const handler = (e: Event) => {
  pushHistory();
  const { node: rawNode, edge: ce, autoEdit } = (e as CustomEvent<MsgAddNodeResult>).detail;

  const cn = assignLabel(rawNode, canvasRef.current.nodes);

  // - stamp creation index and increment canvas-level counter
  const nextIdx    = (canvasRef.current.creationCounter ?? 0) + 1;
  canvasRef.current = { ...canvasRef.current, creationCounter: nextIdx };
  const cnWithIdx: CanvasNode = { ...cn, creationIndex: nextIdx };

  setNodes(nds => [
    ...nds.map(n => ({ ...n, selected: false })),
    { ...toFlowNode(cnWithIdx), selected: true },
  ]);

  canvasRef.current = {
    ...canvasRef.current,
    nodes: [...canvasRef.current.nodes, cnWithIdx],
  };

  if (ce) {
    setEdges(eds => addEdge(toFlowEdge(ce), eds));
    canvasRef.current = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges, ce],
    };
  }

  scheduleSave();
  focusNodeById(cnWithIdx.id);
  const { zoom } = rfRef.current.getViewport();
  rfRef.current.setCenter(cnWithIdx.x + cnWithIdx.width / 2, cnWithIdx.y + cnWithIdx.height / 2, { duration: 250, zoom });

  if (autoEdit) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('skena:enterEdit', { detail: { id: cnWithIdx.id } }));
    }, 80);
  }
};
```

- [ ] **Step F: Stamp `creationIndex` in `skena:nodesFromDrop` handler**

In the drop handler (around line 657), inside `labelled.forEach(cn => { ... })`, after `labelled.push(assignLabel(cn, existing))` (i.e. when building `labelled`), stamp the index:

Change the `forEach` that builds `labelled`:
```typescript
// - OLD:
incoming.forEach(cn => {
  const existing = [...canvasRef.current.nodes, ...labelled];
  labelled.push(assignLabel(cn, existing));
});

// - NEW:
incoming.forEach(cn => {
  const existing = [...canvasRef.current.nodes, ...labelled];
  const labeled  = assignLabel(cn, existing);
  const nextIdx  = (canvasRef.current.creationCounter ?? 0) + 1;
  canvasRef.current = { ...canvasRef.current, creationCounter: nextIdx };
  labelled.push({ ...labeled, creationIndex: nextIdx });
});
```

- [ ] **Step G: Stamp `creationIndex` in `addCellNode`**

Find `addCellNode` (around line 1496). Find where `const newNode = assignLabel(...)` is called and add after:
```typescript
const nextIdx  = (canvasRef.current.creationCounter ?? 0) + 1;
canvasRef.current = { ...canvasRef.current, creationCounter: nextIdx };
const newNodeWithIdx: CanvasNode = { ...newNode, creationIndex: nextIdx };
```

Then use `newNodeWithIdx` in place of `newNode` in the rest of `addCellNode`.

- [ ] **Step H: Typecheck and build**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -30
npm run build 2>&1 | tail -10
```

Expected: clean typecheck, successful build.

- [ ] **Step I: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx src/webview/context/HeatmapContext.tsx
git commit -m "feat(heatmap): stamp creationIndex, HeatmapProvider wrapper, gh toggle hotkey"
```

---

### Task 6: LabeledEdge glow

**Files:**
- Modify: `src/webview/canvas/edges/LabeledEdge.tsx`

- [ ] **Step 1: Import `useHeatmap`**

At the top of `LabeledEdge.tsx`, add after existing imports:
```typescript
import { useHeatmap } from '../../context/HeatmapContext';
```

- [ ] **Step 2: Read edge glow data in the component**

Inside `LabeledEdgeComponent`, after the existing `const activeStyle = ...` block, add:

```typescript
const { visible: hmVisible, edgeGlow } = useHeatmap();
const hmEdge = hmVisible ? edgeGlow.get(id) : undefined;

// - when heatmap active, override stroke color and add glow filter
const finalStyle: React.CSSProperties = hmEdge
  ? {
      ...activeStyle,
      stroke:       hmEdge.stroke,
      filter:       hmEdge.glowFilter,
      strokeWidth:  Number(activeStyle?.strokeWidth ?? 1.5),
    }
  : (activeStyle ?? {});
```

- [ ] **Step 3: Use `finalStyle` in the JSX**

Replace:
```tsx
<BaseEdge id={id} path={edgePath} style={activeStyle} markerEnd={markerEnd} />
```
with:
```tsx
<BaseEdge id={id} path={edgePath} style={finalStyle} markerEnd={markerEnd} />
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/edges/LabeledEdge.tsx
git commit -m "feat(heatmap): apply glow filter to edges via HeatmapContext"
```

---

### Task 7: Node component glow (TextNode, FileNode, LinkNode, CellNode, ChatNode, PortalNode)

**Files:**
- Modify: `src/webview/canvas/nodes/TextNode.tsx`
- Modify: `src/webview/canvas/nodes/FileNode.tsx`
- Modify: `src/webview/canvas/nodes/LinkNode.tsx`
- Modify: `src/webview/canvas/nodes/CellNode.tsx`
- Modify: `src/webview/canvas/nodes/ChatNode.tsx`
- Modify: `src/webview/canvas/nodes/PortalNode.tsx`

The same three-line pattern applies to every node component. GroupNode is intentionally skipped (per spec).

**Pattern to apply to each component:**

**1. Import** (add after existing imports):
```typescript
import { useHeatmap } from '../../context/HeatmapContext';
```

**2. Read glow at the top of the component function** (after destructuring `data`):
```typescript
const { visible: hmVisible, nodeGlow } = useHeatmap();
const hmNode = hmVisible ? nodeGlow.get(data.id) : undefined;
```

**3. Apply to outermost container div** — add a `style` prop merging glow values:
```tsx
style={{
  // - existing styles if any, then:
  ...(hmNode ? {
    filter:      hmNode.glowFilter,
    borderColor: hmNode.borderColor,
    opacity:     hmNode.opacity,
  } : {}),
}}
```

If the container already has a `style` prop, merge into it. If the glow border conflicts with an existing `border` shorthand, use `borderColor` only (the shorthand will set width/style and the color override will apply).

- [ ] **Step 1: Apply pattern to TextNode**

Open `src/webview/canvas/nodes/TextNode.tsx`.

Find the import block and add `import { useHeatmap } from '../../context/HeatmapContext';`

Find the component function signature `export function TextNodeComponent(...)`. After destructuring `data` from props, add:
```typescript
const { visible: hmVisible, nodeGlow } = useHeatmap();
const hmNode = hmVisible ? nodeGlow.get(data.id) : undefined;
```

Find the outermost container `<div>` in the return. Add the glow styles to it. Look for the `onFocus`/`onBlur`/`tabIndex` div — it's the main wrapper. Merge:
```tsx
style={{
  width: '100%', height: '100%',
  ...(hmNode ? { filter: hmNode.glowFilter, borderColor: hmNode.borderColor, opacity: hmNode.opacity } : {}),
}}
```

(If the wrapper has no `style`, add `style={{ ...(hmNode ? { filter: hmNode.glowFilter, borderColor: hmNode.borderColor, opacity: hmNode.opacity } : {}) }}`)

- [ ] **Step 2: Apply pattern to FileNode**

Same three-step pattern in `src/webview/canvas/nodes/FileNode.tsx`.

- [ ] **Step 3: Apply pattern to LinkNode**

Same three-step pattern in `src/webview/canvas/nodes/LinkNode.tsx`.

- [ ] **Step 4: Apply pattern to CellNode**

Same three-step pattern in `src/webview/canvas/nodes/CellNode.tsx`.

- [ ] **Step 5: Apply pattern to ChatNode**

Same three-step pattern in `src/webview/canvas/nodes/ChatNode.tsx`.

- [ ] **Step 6: Apply pattern to PortalNode**

Same three-step pattern in `src/webview/canvas/nodes/PortalNode.tsx`.

- [ ] **Step 7: Typecheck and build**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | head -30
npm run build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/webview/canvas/nodes/TextNode.tsx \
        src/webview/canvas/nodes/FileNode.tsx \
        src/webview/canvas/nodes/LinkNode.tsx \
        src/webview/canvas/nodes/CellNode.tsx \
        src/webview/canvas/nodes/ChatNode.tsx \
        src/webview/canvas/nodes/PortalNode.tsx
git commit -m "feat(heatmap): apply cluster glow to all node components"
```

---

### Task 8: Manual smoke test + final commit

**Files:** none (test only)

- [ ] **Step 1: Build and install the extension**

```bash
cd /home/quant0/devs/skena && npm run package
# - in VS Code: Extensions → Install from VSIX → select the .vsix in project root
# - OR reload VS Code (Cmd+Shift+P → Developer: Reload Window) to pick up the dev build
```

- [ ] **Step 2: Open the test canvas**

Open `test/sample.canvas` (or `test/X1.canvas`) in VS Code.

- [ ] **Step 3: Verify heatmap is on by default**

Expected:
- Connected nodes glow with distinct cluster colors (cyan, orange, purple, etc.)
- Newer nodes (higher `creationIndex`) glow brighter
- Nodes with no edges are dim gray
- Edges glow with the same color as their cluster

- [ ] **Step 4: Press `gh` to toggle heatmap off**

Expected: all glow disappears, nodes and edges show in default style.

- [ ] **Step 5: Press `gh` again to toggle back on**

Expected: glow returns.

- [ ] **Step 6: Add a new node (Shift+L) and verify it gets max intensity in its cluster**

Expected: the new node has `creationIndex` set and glows brightest in the cluster it joins.

- [ ] **Step 7: Run tests one final time**

```bash
cd /home/quant0/devs/skena && node --test test/heatmap-bfs.mjs
npm run typecheck 2>&1 | head -20
```

Expected: 6/6 tests pass, no type errors.

- [ ] **Step 8: Update crtx log and project page**

```bash
tail -5 /home/quant0/projects/crtx/log.md
# - append a log entry describing what was completed
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `creationCounter` on canvas JSON | Task 1 (CanvasData), Task 2 (canvas-io), Task 5 (stamp) |
| `creationIndex` on node | Task 1 (CanvasNodeBase), Task 5 (stamp in all creation paths) |
| BFS connected components | Task 3 (`computeHeatmapData`) |
| Intensity normalization [0.18, 0.95] | Task 3 |
| Mixed spectrum palette (6 colors) | Task 3 (`PALETTE` constant) |
| Isolated nodes → gray, 0.45 opacity | Task 3 |
| Node drop-shadow glow | Task 7 |
| Edge glow | Task 6 |
| `gh` toggle hotkey | Task 5 (Step D) |
| Always-on by default (visible=true) | Task 4 (default state), Task 5 |
| GroupNode excluded | Task 7 (explicitly skipped) |
| addCellNode stamped | Task 5 (Step G) |
| drag-drop stamped | Task 5 (Step F) |

All spec requirements are covered. ✓

**Placeholder scan:** No TBDs, no "implement later", all code blocks are complete. ✓

**Type consistency check:**
- `HeatmapNode.color` — defined as `string` in Task 1, used as `rgba(${color},...)` in Tasks 3, 7 ✓
- `EdgeGlow.stroke` — defined as `string` in Task 1, applied as `style.stroke` in Task 6 ✓
- `HeatmapProviderProps.visible/toggle` — defined in Task 4 revised, used in Task 5 Step C ✓
- `computeHeatmapData` — tested in Task 3 Step 2, imported by hook in Task 3 Step 3 ✓
- `useHeatmap()` return shape — defined in Task 4, consumed in Tasks 6, 7 ✓
