# Section Kernels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a section's kernel is picked or created from the rail and stored as a `KernelRecord` in `canvas.metadata.kernels` — no kernel node needed; kernel nodes keep working through edges.

**Architecture:** one view of "a kernel" (`KernelLike`) resolved by `kernelById(canvas, id)` from records first, then nodes; every host and MCP consumer of `KernelNode` reads through it and mutates the returned live object (record or node) for the `kernelId` write-back. Records are created and removed by the host (written at once), mirrored by the webview and saved with the canvas like sections; the host stays authoritative for the live `kernelId` and the healed `spec` (merged on save). The rail's picker lists records with a live LED, then legacy nodes, then *New kernel…* (the existing host QuickPick, answering with a record instead of a node) and *Remove kernel…*. Run-with-upstream on a section-bound chain orders the edge-connected code cells by `(y, x)`.

**Tech Stack:** TypeScript, React 18, React Flow v12, esbuild, `node --test` on bundled pure modules.

**Spec:** `docs/superpowers/specs/2026-09-03-section-kernels-design.md`.

**Verification:** `npm run typecheck` → exactly the 3 pre-existing `fsPath` errors in `src/extension/editor-provider.ts`; `npm run build` → three `⚡ Done`; kernel-binding tests: `npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs`; kernel-upstream tests likewise with `--outfile=test/.build/kernel-upstream.mjs && node --test test/kernel-upstream.mjs`.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/shared/types.ts` | `KernelRecord`; `metadata.kernels`; `MsgAddKernel.forSection`; `MsgKernelAdded`, `MsgRemoveKernel`, `MsgKernelRemoved`; doc on `MsgKernelAction.kernelNodeId` |
| `src/shared/kernelBinding.ts` | `KernelLike`, `kernelById`; `CellKernelCanvas.kernels`; `upstreamCellsForRun` (edge chain, else by position) |
| `src/extension/editor-provider.ts` | every `KernelNode` consumer → `kernelById`; `handleAddKernel` record mode; `handleRemoveKernel`; save merge of `kernels` |
| `src/extension/mcp/server.ts` | `canvas_run_cell` `kernelRef` over records; `canvas_list` `Kernels:` block |
| `src/webview/hooks/useKernelState.ts` | the LED hook, moved out of `KernelNode.tsx` |
| `src/webview/canvas/KernelsContext.ts` | `metadata.kernels` for node components |
| `src/webview/canvas/CanvasView.tsx` | `kernels` state + `commitKernels`; `kernelAdded` / `kernelRemoved` / `runOutput` handling; `railKernels` from records |
| `src/webview/rail/KernelPicker.tsx`, `SegmentMenu.tsx`, `RailSegment.tsx`, `SectionRail.tsx` | records with LED, New kernel…, Remove kernel…, kernel actions in the menu |

---

### Task 1: types, `kernelById`, the resolver accepts record ids (pure)

**Files:** `src/shared/types.ts`, `src/shared/kernelBinding.ts`; test `test/kernel-binding.mjs`

- [ ] **Step 1: failing tests** — append to `test/kernel-binding.mjs` (extend the import with `kernelById`):

```js
test('resolveCellKernel: a section bound to a kernel RECORD resolves to it', () => {
  const c = { nodes: [cell('E1', 0)], edges: [], sections: [lane('a', 0, 'k-1')], kernels: [{ id: 'k-1' }] };
  assert.equal(resolveCellKernel('E1', c), 'k-1');
});

test('kernelById: record first, then kernel node, else null; returns the live object', () => {
  const rec = { id: 'k-1', server: 's', colorIndex: 0 };
  const node = { id: 'K1', type: 'kernel', server: 's', x: 0, y: 0, width: 1, height: 1 };
  const canvas = { nodes: [node], edges: [], metadata: { kernels: [rec] } };
  assert.equal(kernelById(canvas, 'k-1'), rec);
  assert.equal(kernelById(canvas, 'K1'), node);
  assert.equal(kernelById(canvas, 'nope'), null);
  assert.equal(kernelById({ nodes: [node], edges: [] }, 'k-1'), null);
});
```

- [ ] **Step 2: run to verify they fail.**

- [ ] **Step 3: implementation**

`src/shared/types.ts` — after `KernelNode`:

```ts
/** A kernel that lives in the canvas file, not on the canvas: picked or created from a section's rail. */
export interface KernelRecord {
  id: string;            // - "k-<base36 time>", stable
  server: string;        // - a skena.jupyter.kernels[].name
  spec?: string;         // - kernelspec to (re)launch from; a restart uses the same environment
  displayName?: string;
  kernelId?: string;     // - live Jupyter kernel id once started / attached; absent = not running
  colorIndex: number;    // - into KERNEL_PALETTE, assigned at creation
}
```

`CanvasData.metadata` gains `kernels?: KernelRecord[];` with the comment `// - kernels without a node; a section's kernelId may name one of these`. `MsgAddKernel` becomes `{ type: 'addKernel'; position?: { x: number; y: number }; forSection?: string; }` (`// - forSection → the host answers with a KernelRecord bound to that section instead of a node`). `MsgKernelAction.kernelNodeId` doc: `// - a KernelRecord id or a kernel node id`. Add host→webview `export interface MsgKernelAdded { type: 'kernelAdded'; sectionId: string; kernel: KernelRecord; }` and `export interface MsgKernelRemoved { type: 'kernelRemoved'; kernelId: string; }` (add both to the `HostToWebview` union), and webview→host `export interface MsgRemoveKernel { type: 'removeKernel'; kernelId: string; }` (add to `WebviewToHost`).

`src/shared/kernelBinding.ts`:

```ts
export interface CellKernelCanvas {
  nodes:    { id: string; type: string; y: number }[];
  edges:    EdgeLike[];
  sections: SectionLane[] | undefined;
  kernels?: { id: string }[];   // - kernel records: valid targets for a section's kernelId
}

export function cellKernelView(c: Pick<CanvasData, 'nodes' | 'edges' | 'metadata'>): CellKernelCanvas {
  return { nodes: c.nodes, edges: c.edges, sections: c.metadata?.sections, kernels: c.metadata?.kernels };
}
```

In `makeCellKernelResolver`: `const recordIds = new Set((c.kernels ?? []).map(k => k.id));` and the section step becomes `return lane.kernelId && (recordIds.has(lane.kernelId) || isKernel(lane.kernelId)) ? lane.kernelId : null;` (edge BFS still only stops at kernel *nodes* — records have no edges).

Append:

```ts
/** What every kernel consumer reads: a KernelRecord or a KernelNode, by reference (mutations land). */
export interface KernelLike { id: string; server: string; kernelId?: string; spec?: string; displayName?: string; colorIndex?: number }

export function kernelById(c: { nodes: { id: string; type?: string }[]; metadata?: { kernels?: KernelRecord[] } }, id: string): KernelLike | null {
  const rec = c.metadata?.kernels?.find(k => k.id === id);
  if (rec) return rec;
  const node = c.nodes.find(n => n.id === id && n.type === 'kernel');
  return node ? (node as unknown as KernelLike) : null;
}
```

(import `KernelRecord` type from `./types`.)

- [ ] **Step 4: tests pass (18); typecheck (3 pre-existing); commit**

```bash
git add src/shared/types.ts src/shared/kernelBinding.ts
git commit -m "feat: KernelRecord — kernels in canvas metadata; kernelById reads records first, then nodes; section binding accepts record ids"
```

---

### Task 2: run-with-upstream by position for section-bound chains (pure)

> Also in Task 2 (from Task 1's review): rename `MsgRemoveKernel.kernelId` and `MsgKernelRemoved.kernelId` to `kernelRef` (a record or node id; `kernelId` means the live Jupyter id everywhere else); `kernelById` takes `Pick<CanvasData, 'nodes' | 'metadata'>`; single cast `node as KernelLike`; doc that `KernelLike.colorIndex` is optional only for nodes.

**Files:** `src/shared/kernelBinding.ts`; test `test/kernel-upstream.mjs`

- [ ] **Step 1: failing tests** — append to `test/kernel-upstream.mjs` (extend the import with `upstreamCellsForRun`):

```js
const pcell = (id, y, x = 0) => ({ id, type: 'code', y, x });
test('upstreamCellsForRun: with an edge path to a kernel node the edge chain is used, as before', () => {
  const c = { nodes: [{ id: 'K1', type: 'kernel', y: 0, x: 0 }, pcell('E1', 900), pcell('E2', 0)], edges: [{ fromNode: 'K1', toNode: 'E1' }, { fromNode: 'E1', toNode: 'E2' }], sections: [], kernels: [] };
  assert.deepEqual(upstreamCellsForRun('E2', c), ['E1']);   // - edge order, even though E1 sits lower
});
test('upstreamCellsForRun: section-bound chain → the connected code cells above the target, by (y, x)', () => {
  const c = {
    nodes: [pcell('E1', 0), pcell('E2', 300, 800), pcell('E3', 300, 0), pcell('E4', 900), pcell('X', 100), { id: 'T', type: 'text', y: 50, x: 0 }],
    edges: [{ fromNode: 'E1', toNode: 'E3' }, { fromNode: 'E3', toNode: 'E2' }, { fromNode: 'E2', toNode: 'E4' }, { fromNode: 'E1', toNode: 'T' }],
    sections: [{ id: 'a', y: 0, createdAt: 1, kernelId: 'k-1' }], kernels: [{ id: 'k-1' }],
  };
  assert.deepEqual(upstreamCellsForRun('E4', c), ['E1', 'E3', 'E2']);   // - X is not connected; T is not code; E3 (x 0) before E2 (x 800)
  assert.deepEqual(upstreamCellsForRun('E1', c), []);
});
test('upstreamCellsForRun: no kernel at all → []', () => {
  assert.deepEqual(upstreamCellsForRun('E2', { nodes: [pcell('E1', 0), pcell('E2', 100)], edges: [{ fromNode: 'E1', toNode: 'E2' }], sections: [], kernels: [] }), []);
});
```

- [ ] **Step 2: run to verify they fail.**

- [ ] **Step 3: implementation** — append to `src/shared/kernelBinding.ts`:

```ts
/**
 * The cells to run before `targetId`. With an edge path to a kernel node: the edge chain
 * (`resolveUpstreamChain`). Otherwise, when the target's section supplies the kernel: the target's
 * edge-connected code cells that sit above it, top to bottom then left to right — edges drawn by the
 * user in a section-bound chain have no kernel to orient them, so position does.
 */
export function upstreamCellsForRun(targetId: string, c: CellKernelCanvas & { nodes: { id: string; type: string; y: number; x?: number }[] }): string[] {
  const byId = new Map(c.nodes.map(n => [n.id, n]));
  const isKernel = (id: string) => byId.get(id)?.type === 'kernel';
  const isCode = (id: string) => byId.get(id)?.type === 'code';
  if (resolveBoundKernel(targetId, c.edges, isKernel)) return resolveUpstreamChain(targetId, c.edges, isKernel, isCode);
  if (!resolveCellKernel(targetId, c)) return [];
  const target = byId.get(targetId);
  if (!target) return [];
  // - the target's connected component, walking through code cells only
  const seen = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const e of c.edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || seen.has(nb) || !isCode(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  const pos = (id: string) => { const n = byId.get(id); return { y: n?.y ?? 0, x: n?.x ?? 0 }; };
  const t = pos(targetId);
  return [...seen]
    .filter(id => id !== targetId)
    .filter(id => { const p = pos(id); return p.y < t.y || (p.y === t.y && p.x < t.x); })
    .sort((a, b) => { const pa = pos(a), pb = pos(b); return pa.y - pb.y || pa.x - pb.x; });
}
```

`CellKernelCanvas.nodes` entries may carry `x` — extend the interface: `nodes: { id: string; type: string; y: number; x?: number }[]` so `cellKernelView` (CanvasNode has `x`) and the webview mapping (add `x: n.position.x`) both satisfy it.

- [ ] **Step 4: tests pass (11); commit**

```bash
git add src/shared/kernelBinding.ts
git commit -m "feat: upstreamCellsForRun — edge chain when a kernel node is reachable, else the connected code cells above the target by position"
```

---

### Task 3: host — every kernel consumer reads through `kernelById`; New kernel… answers with a record

**Files:** `src/extension/editor-provider.ts`

- [ ] **Step 1: consumers** — replace each `canvas.nodes.find(n => n.id === <id> && n.type === 'kernel') as KernelNode | undefined` (and the `nodeById.get(kid) as KernelNode` variants) with `kernelById(canvas, <id>)` typed `KernelLike | null`, at: `runOneCell` (~1374: `kernelNode` → `kernel`; the later write-back at ~1424 becomes `const k = kernelById(c, kernel.id); if (k && kernelId !== k.kernelId) k.kernelId = kernelId;`; the agent-run persist write-back at ~1276 likewise), `handleComplete` (~1673), `handleInspect` (~1701), `handleInterruptCell` (~1814), `handleKernelAction` (~1753: lookup by `msg.kernelNodeId`; `kernelNode.*` → `kernel.*`; `resolveKernelCellsInCanvas(kernel.id, …)`). All reads are `server`, `kernelId`, `spec`, `displayName`, `id` — `KernelLike` has them. Every `runStatus` / `runOutput` `kernelNodeId: kernel.id` (the field keeps its name; its value is now a record or node id — say so in the type's doc comment).
  `reconcileRunFlags` (~1723): iterate `[...canvas.nodes.filter(kernel nodes), ...(canvas.metadata?.kernels ?? [])]` as `KernelLike[]` with the same body.
  Run-with-upstream (`handleRunCell` ~1597): replace the `resolveUpstreamChain(...)` call (and its `typeOf` helper) with `upstreamCellsForRun(msg.cellNodeId, cellKernelView(canvas))`.

- [ ] **Step 2: `handleAddKernel` record mode** — after the pick and the optional `startKernel`, when `msg.forSection` is set: build `const kernel: KernelRecord = { id: \`k-${Date.now().toString(36)}\`, server: pick.server, kernelId, displayName, spec: pick.specName ?? pick.display, colorIndex: nextKernelColorIndex(existingCount) }` where `existingCount = (document.canvas.metadata?.kernels?.length ?? 0) + document.canvas.nodes.filter(n => n.type === 'kernel').length` (`nextKernelColorIndex` lives in `src/webview/canvas/palette.ts` — move it and `KERNEL_PALETTE`'s length logic to a host-safe spot: `src/shared/kernelPalette.ts` exporting `KERNEL_PALETTE`, `kernelColor`, `nextKernelColorIndex`, and have `src/webview/canvas/palette.ts` re-export them). Then `send({ type: 'kernelAdded', sectionId: msg.forSection, kernel })` and return — the webview stores and binds it. Without `forSection` the node path is unchanged.

- [ ] **Step 3: `handleRemoveKernel`** — new `case 'removeKernel'`: find the record; `showWarningMessage('Remove kernel "<name>"? Sections bound to it lose their kernel.', { modal: true }, 'Remove')`; on confirm, if `kernelId` is live → `manager.shutdown(server, kernelId)` (ignore errors); `send({ type: 'kernelRemoved', kernelId: msg.kernelId })`. The webview removes the record, unbinds sections and saves.

- [ ] **Step 4: save merge** — in `handleSaveCanvas`'s `metadata` merge (~801) add, next to `sections`:
```ts
          // - kernels: the webview owns which records exist and their colour; the host owns the live kernelId
          kernels: msg.canvas.metadata?.kernels?.map(k => {
            const live = document.canvas.metadata?.kernels?.find(h => h.id === k.id);
            return live ? { ...k, kernelId: live.kernelId } : k;
          }) ?? document.canvas.metadata?.kernels,
```

- [ ] **Step 5: typecheck (3 pre-existing), build; commit**

```bash
git add src/extension/editor-provider.ts src/shared/kernelPalette.ts src/webview/canvas/palette.ts
git commit -m "feat: host reads any kernel through kernelById; New kernel… for a section answers with a record; remove kernel; live kernelId merged on save"
```

---

### Task 4: MCP — records in `canvas_run_cell` and `canvas_list`

**Files:** `src/extension/mcp/server.ts`

- [ ] `canvas_run_cell`: `kernelRef` resolves through `kernelById(d, ref)`, then by a record's `displayName` or a node's `nodeLabel`; the fallback stays `resolveCellKernel` → `kernelById`. `kernelNode.*` → `kernel.*`; the "vanished" re-read after the upstream loop uses `kernelById(d, kernel.id)`. The upstream list: `upstreamCellsForRun(cell.id, cellKernelView(d))`. Tool description + `kernelRef` doc: "a kernel record id/display name or a kernel node label/id".
- [ ] `canvas_list`: after `Sections:`, a `Kernels:` block when `d.metadata?.kernels?.length`: `  k-1  quantkit  server=quantlab  live=<kernelId first 8 or ->` per record (same padding style as `Sections:`).
- [ ] typecheck, build; commit `feat: MCP run_cell accepts kernel records; canvas_list shows kernels`.

---

### Task 5: webview — kernels state, picker with LED and New/Remove, kernel actions in the menu

**Files:** `src/webview/hooks/useKernelState.ts` (new; move `useKernelState` out of `KernelNode.tsx` and import it there), `src/webview/canvas/KernelsContext.ts` (new; like `LanesContext`), `src/webview/canvas/CanvasView.tsx`, `src/webview/canvas/nodes/CodeNode.tsx`, `src/webview/App.tsx`, `src/webview/rail/KernelPicker.tsx`, `SegmentMenu.tsx`, `RailSegment.tsx`, `SectionRail.tsx`

- [ ] **State** — `CanvasView`: `const [kernels, setKernels] = useState<KernelRecord[]>(canvas.metadata?.kernels ?? []); useEffect(() => setKernels(canvas.metadata?.kernels ?? []), [canvas]);` next to `lanes`; `commitKernels(next)` mirrors `commitLanes` (state + `canvasRef.metadata.kernels` + `scheduleSave`). `HistoryEntry` gains `kernels` the same way `sections` was added (push/undo/redo/apply). Provide `<KernelsContext.Provider value={kernels}>` next to `LanesContext`.
- [ ] **Resolver** — `CodeNode`'s cache key gains `kernels` (from `useKernels()`), the view passes `kernels` and `x: n.position.x`.
- [ ] **Events** — `App.tsx`: `case 'kernelAdded'` → `window.dispatchEvent(new CustomEvent('skena:kernelAdded', { detail: msg }))`; `case 'kernelRemoved'` likewise. `CanvasView`: on `kernelAdded` → mirror what the host already wrote: `commitKernels([...kernels, kernel]); commitLanes(lanes.map(l => l.id === sectionId ? { ...l, kernelId: kernel.id } : l));` — no `pushHistory` (a host write is not undoable from the webview; undo would desync the two). On `kernelRemoved` → `commitKernels(kernels.filter(k => k.id !== kernelRef)); commitLanes(lanes.map(l => l.kernelId === kernelRef ? (({ kernelId: _k, ...rest }) => rest)(l) : l));`, again without history. On `runOutput` (existing handler ~2717): if `msg.kernelNodeId` names a record and `msg.kernelId` differs → `commitKernels` with the updated `kernelId` (so the LED and the saved file follow the live kernel).
- [ ] **`railKernels`** — records first: `{ id, label: displayName ?? 'kernel', name: server, colorIndex, server, kernelId, kind: 'record' }`, then kernel nodes as today with `kind: 'node'`. `RailKernel` gains `server`, `kernelId?`, `kind`.
- [ ] **Picker** — rows for records: LED dot (`useKernelState(server, kernelId)`, colours as `KernelNode`'s `LED_COLOR`) + the record's colour dot + `displayName` + `server`; a small `✕` at the row's right → `onRemove(kernelId)` (records only); then a separator and legacy node rows; then `New kernel…` → `onNew()` (posts `{ type: 'addKernel', forSection: laneId }` then closes); then `none`. Prop additions: `onNew`, `onRemove`.
- [ ] **Menu** — `SegmentMenu` gets `kernelBound: boolean` and, when true, rows Start · Interrupt · Restart · Shutdown before the separator → `onKernelAction(action)` → `vscodePostMessage({ type: 'kernelAction', action, kernelNodeId: lane.kernelId })`. `RailSegment`'s dot tooltip: `${name} · ${server} · ${state}` (state via `useKernelState` inside `RailSegment` for bound records; for nodes keep the old text).
- [ ] typecheck (3 pre-existing), build; commit `feat: rail kernels — records with a live LED, New kernel… creates one for the section, Remove kernel…, kernel actions in the segment menu`.

---

### Task 6: verification

- [ ] All suites pass (kernel-binding 18, kernel-upstream 11, plus bounds / section-lanes / rail-geometry unchanged); typecheck; build; bump to `0.17.3` and `npm run package`.
- [ ] Manual (user): dot → New kernel… → pick a spec → the stripe takes the colour, the LED goes green; a code cell with no edge runs on it; right-click → Restart clears the run flags of the section's cells; Shutdown greys the LED; reopen → record and binding survive; Remove kernel… → confirm → section unbound; run-with-upstream on two edge-connected cells in a section-bound chain runs the upper first.

---

## Self-review

Spec §1 → Task 1; §2 → Tasks 1, 3, 4; §3 → Task 5; §4 → Task 2 (+ host/MCP callers in 3–4); §5 (remove) → Tasks 3, 5; §6 tests → Tasks 1–2. `KernelLike`, `kernelById`, `upstreamCellsForRun`, `MsgKernelAdded`, `MsgRemoveKernel`, `MsgKernelRemoved`, `KernelsContext`, `commitKernels`, `RailKernel.kind` named consistently across tasks. Known limits: records are per canvas; the `runStatus.kernelNodeId` field keeps its name.
