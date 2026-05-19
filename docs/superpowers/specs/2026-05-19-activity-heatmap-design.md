# Activity Heatmap — Design Spec

**Date:** 2026-05-19
**Branch:** feature/ai-companion
**Status:** Approved — ready for implementation

---

## Overview

A visual overlay that reveals the **creation history** of a canvas by coloring every node and edge according to which *cluster* it belongs to and how recently it was created relative to other nodes in the same cluster. Nodes connected by edges form clusters (connected components); each cluster gets a distinct palette color. Within a cluster, brightness indicates recency — newest nodes glow brightest, oldest are dim. Isolated nodes (no edges) are always neutral gray.

The heatmap is persistent (survives reopen), always visible by default, and togglable with `gh`.

---

## 1. Data Model

### 1.1 `creationCounter` on the canvas

A single monotonically increasing integer is stored at the **canvas level** (top of the JSON):

```jsonc
{
  "creationCounter": 42,
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

Every time a new node is created, `creationCounter` is incremented and its current value is stamped onto the node as `creationIndex`.

### 1.2 Node field: `creationIndex`

```typescript
interface CanvasNodeBase {
  // ... existing fields ...
  creationIndex?: number;   // assigned at creation time, never mutated
}
```

- Assigned once at creation, never mutated later.
- Nodes added before this feature shipped have `creationIndex = undefined`; they are treated as the oldest possible (rank 0) within their cluster.
- `lastTouched` (already in `CanvasNodeBase`) is not used for the heatmap. `creationIndex` is the sole ranking signal.

### 1.3 Canvas-level counter persistence

The counter lives in the `.canvas` JSON. Reads/writes go through the existing `readCanvas` / `writeCanvas` helpers in `canvas-io.ts`. Both helpers need a one-line change to carry `creationCounter` through.

---

## 2. Algorithm (`useActivityHeatmap`)

### 2.1 Connected-component detection (BFS)

```
Input:  nodes[], edges[]
Output: Map<nodeId, clusterId>  (isolated nodes get clusterId = null)

1. Build adjacency list from edges[] (undirected).
2. BFS from each unvisited node.
   - If a node has at least one edge → assign clusterId (incrementing integer).
   - If a node has no edges → clusterId = null (isolated).
3. Result: clusterOf: Map<nodeId, number | null>
```

### 2.2 Intensity normalization

Within each cluster, rank nodes by `creationIndex` (ascending, ties share rank). Map rank to `[0.18 … 0.95]` linearly:

```
intensity = 0.18 + (rank / maxRank) * (0.95 - 0.18)
```

Nodes with `creationIndex = undefined` get rank 0 (dimest).

### 2.3 `HeatmapNode` output type

```typescript
type HeatmapNode = {
  nodeId:    string;
  color:     string;       // rgb(...) — cluster palette color, or 'gray'
  intensity: number;       // [0.18, 0.95]
  clusterId: number | null;
};
```

### 2.4 Edge glow

Each edge gets:
- `color` = source node's cluster color (if source and target are in the same cluster)
- `intensity` = `Math.max(sourceNode.intensity, targetNode.intensity)`
- Edges whose endpoints are in different clusters (shouldn't happen in BFS, but defensive) → gray, low intensity.

---

## 3. Palette

**Mixed spectrum** — 6 colors, cycling for > 6 clusters:

| Index | Color   | RGB             |
|-------|---------|-----------------|
| 0     | cyan    | 56, 189, 248    |
| 1     | orange  | 251, 146, 60    |
| 2     | purple  | 167, 139, 250   |
| 3     | green   | 52, 211, 153    |
| 4     | pink    | 244, 114, 182   |
| 5     | yellow  | 250, 204, 21    |
| —     | gray    | 140, 140, 140   |

Isolated nodes always get gray regardless of which palette slot would have been assigned.

---

## 4. Visual Style

**Node glow:** CSS `filter: drop-shadow()`

```css
/* Example: cyan cluster, high intensity */
filter: drop-shadow(0 0 9px rgba(56,189,248,0.95))
        drop-shadow(0 0 18px rgba(56,189,248,0.45));
border-color: rgba(56,189,248,0.65);

/* Low intensity (old) */
filter: drop-shadow(0 0 3px rgba(56,189,248,0.28));
border-color: rgba(56,189,248,0.18);

/* Isolated — gray, faded */
filter: drop-shadow(0 0 2px rgba(140,140,140,0.25));
border-color: rgba(140,140,140,0.18);
opacity: 0.45;
```

The `intensity` value drives both the drop-shadow radius/opacity and the border-color alpha linearly.

**Edge glow:** Custom ReactFlow edge type `GlowEdge`.

Each edge renders two SVG `<path>` elements:
1. **Glow layer** — thick stroke, blurred via `<feGaussianBlur>` SVG filter, opacity ≈ 60% of full.
2. **Core line** — thin sharp stroke at full opacity.

The edge takes `color` and `intensity` as props and scales stroke width and filter blur by intensity.

---

## 5. React Architecture

### 5.1 `HeatmapContext`

```typescript
// src/webview/context/HeatmapContext.tsx
type HeatmapContextValue = {
  visible:   boolean;
  toggle:    () => void;
  nodeGlow:  Map<string, HeatmapNode>;   // keyed by nodeId
  edgeGlow:  Map<string, EdgeGlow>;      // keyed by edgeId
};
```

Provider wraps the canvas. `useHeatmap()` hook for consumers.

### 5.2 `useActivityHeatmap(nodes, edges)`

```typescript
// src/webview/hooks/useActivityHeatmap.ts
function useActivityHeatmap(
  nodes: AppNode[],
  edges: Edge[],
): { nodeGlow: Map<string, HeatmapNode>; edgeGlow: Map<string, EdgeGlow> }
```

- Pure computation (no side effects).
- `useMemo`-d on `nodes` and `edges` identity.
- Re-runs on any node/edge add/remove.

### 5.3 Node component integration

Each node component calls `useHeatmap()`. When `visible`:
- Reads `nodeGlow.get(id)` → derives `filter` + `borderColor` style props.
- Applied to the outermost container div (not inner content).
- When `!visible` → no style override.

### 5.4 `GlowEdge` custom edge

```typescript
// src/webview/canvas/edges/GlowEdge.tsx
```

Registered in ReactFlow's `edgeTypes`. Renders the two-layer SVG path (glow + core). Falls back to a plain gray line when heatmap is off.

### 5.5 Toggle hotkey

`gh` in CanvasView's vim-style key handler (existing pattern, non-modal) → calls `toggle()` from HeatmapContext.

---

## 6. Wire-up Checklist

1. **`canvas-io.ts`** — carry `creationCounter` through `readCanvas`/`writeCanvas`.
2. **`types.ts`** — add `creationIndex?: number` to `CanvasNodeBase`; add `creationCounter?: number` to `CanvasData`.
3. **`CanvasView.tsx`** — stamp `creationIndex` on every new node creation path; increment `creationCounter`; pass `nodes` + `edges` to `useActivityHeatmap`; `gh` hotkey wired to `toggle()`; wrap with `HeatmapProvider`.
4. **`useActivityHeatmap.ts`** — BFS + intensity computation.
5. **`HeatmapContext.tsx`** — context + provider + `useHeatmap` hook.
6. **Node components** (TextNode, FileNode, UrlNode, GroupNode, etc.) — apply glow styles from context.
7. **`GlowEdge.tsx`** — custom edge with SVG glow filter.
8. **`App.tsx`** / ReactFlow setup — register `GlowEdge` in `edgeTypes`.

---

## 7. Non-Goals

- No time-based decay (creation index only, no wall-clock timestamps).
- No per-cluster legend UI in the canvas (toggle key `gh` is the only UI).
- No heatmap for group/portal nodes (they are containers, not content nodes — treat as isolated).
- No animation of glow pulsing.
