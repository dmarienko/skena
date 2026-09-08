# MCP Section Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every section and kernel operation the rail offers exists as an MCP tool and obeys the same rules, through the same pure functions.

**Architecture:** three small pure helpers join `src/shared/sectionLanes.ts` (`sectionByRef`, `insertLaneAt`, `foldLane`); `src/extension/mcp/server.ts` gains six tools built on them plus the existing `applyLaneFit`, `unfoldLane`, `pruneFoldedIds`, `pinOutputToLane`, `memberCodeCellsInRunOrder`, `kernelById`, `resolveKernelCellsInCanvas`; the node tools clamp to the origin after snapping. An open panel mirrors by reload (MCP writes are plain).

**Tech Stack:** TypeScript, esbuild, `node --test` on bundled pure modules; a stdio JSON-RPC probe over `dist/mcp-server.js` for the tools.

**Spec:** `docs/superpowers/specs/2026-09-08-mcp-section-parity-design.md`.

**Verification:** `npm run typecheck` → exactly the 3 pre-existing `fsPath` errors; `npm run build` → three `⚡ Done`; section-lanes suite via the command on `test/section-lanes.mjs`'s first line.

---

### Task 1: pure helpers — `sectionByRef`, `insertLaneAt`, `foldLane`

**Files:** `src/shared/sectionLanes.ts`; test `test/section-lanes.mjs`

- [ ] **Tests** (append; extend the import with `sectionByRef, insertLaneAt, foldLane`):

```js
test('sectionByRef: S# by stack order, or the lane id; null otherwise', () => {
  const lanes = [lane('b', 1000), lane('a', 0)];
  assert.equal(sectionByRef(lanes, 'S1').id, 'a');
  assert.equal(sectionByRef(lanes, 's2').id, 'b');
  assert.equal(sectionByRef(lanes, 'b').id, 'b');
  assert.equal(sectionByRef(lanes, 'S3'), null);
  assert.equal(sectionByRef(lanes, 'nope'), null);
});

test('insertLaneAt: snapped, inserted, sorted; same reference when a lane already starts there', () => {
  const lanes = [lane('a', 0), lane('c', 2000)];
  const out = insertLaneAt(lanes, 1049, 7, 'sec-x');
  assert.deepEqual(out.map(l => [l.id, l.y]), [['a', 0], ['sec-x', 1000], ['c', 2000]]);
  assert.equal(insertLaneAt(lanes, 2000, 7, 'sec-y'), lanes);
  assert.equal(insertLaneAt(lanes, -50, 7, 'sec-z'), lanes);   // - above the origin: refused
});

test('foldLane: lists the visible members, ignores already-pinned ids, same reference when folded', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  const nodes = [node('n1', 0), node('n2', 300), node('n3', 1000)];
  const out = foldLane(lanes, nodes, 'a');
  assert.deepEqual(out[0].folded, ['n1', 'n2']);
  assert.equal(foldLane(out, nodes, 'a'), out);
  assert.equal(foldLane(lanes, nodes, 'zzz'), lanes);
});
```

- [ ] **Implementation** (append after `pruneFoldedIds`):

```ts
/** A section by its printed label (S1… in stack order, case-insensitive) or its id. */
export function sectionByRef(lanes: SectionLane[], ref: string): SectionLane | null {
  const sorted = sortLanes(lanes);
  const m = /^s(\d+)$/i.exec(ref.trim());
  if (m) return sorted[Number(m[1]) - 1] ?? null;
  return sorted.find(l => l.id === ref) ?? null;
}

/**
 * Insert a lane starting at `y` (snapped to the grid): the lane it lands in is split, nodes stay where
 * they are and membership follows `y`. Same reference when a lane already starts there or `y` is above
 * the origin.
 */
export function insertLaneAt(lanes: SectionLane[], y: number, now: number, id = `sec-${now.toString(36)}`): SectionLane[] {
  const at = Math.round(y / GRID) * GRID;
  if (at < 0 || lanes.some(l => l.y === at)) return lanes;
  return sortLanes([...lanes, { id, y: at, createdAt: now }]);
}

/** Fold a section: pin its visible members. Same reference when it is already folded or unknown. */
export function foldLane(lanes: SectionLane[], nodes: LaneNodeGeom[], id: string): SectionLane[] {
  const target = deriveLanes(nodes, lanes).find(l => l.id === id);
  if (!target || target.folded) return lanes;
  return lanes.map(l => (l.id === id ? { ...l, folded: target.memberIds } : l));
}
```

- [ ] Tests pass (43); typecheck; commit `feat: sectionByRef, insertLaneAt, foldLane — the pure parts of the MCP section tools`.

---

### Task 2: node tools clamp; `canvas_list` / `canvas_read` show fold state

**Files:** `src/extension/mcp/server.ts`

- [ ] Import `clampToOrigin` from `'../../shared/bounds'`. In `canvasAddNode` (`base.x/y`), `canvasUpdateNode` (the `args.x`/`args.y` branches) and `canvasLayout` (per item), apply `clampToOrigin` after `snapGrid` on both axes (x and y together: `const c = clampToOrigin(snapGrid(x), snapGrid(y))`), comment `// - never off the canvas, as the webview's creation funnel`. Descriptions of the three tools: append ` Coordinates are snapped to the grid and clamped to the canvas origin.`
- [ ] `canvas_list` `Sections:` line: append ` folded` when `l.folded` and ` nodes=<memberIds.length>` (the count includes hidden members). `canvas_read`: after the `Section:` line, ` hidden (folded)` when the node's id is in that lane's `folded` list.
- [ ] typecheck, build; commit `feat: MCP node tools clamp to the origin; list/read show fold state`.

---

### Task 3: `canvas_add_section`, `canvas_remove_section`, `canvas_update_section`

**Files:** `src/extension/mcp/server.ts`

- [ ] Imports from `'../../shared/sectionLanes'`: `sectionByRef, insertLaneAt, foldLane, unfoldLane, sectionTargetHeight, parkFirstLaneAtOrigin, deriveLanes` (some exist). `kernelByRef` exists in the file (record id / display name / node label/id).
- [ ] `canvasAddSection(args)`: `withFileLock`; `d = readCanvasOrEmpty(p)`; `lanes = d.metadata?.sections ?? []`; `now = Date.now()`; if `args.y !== undefined` → `next = insertLaneAt(lanes, args.y, now)`, error `'error: a section already starts at y=<snapped>'` (or `'error: y must be ≥ 0'`) when the reference is unchanged; else append: `last = deriveLanes(d.nodes, lanes).at(-1)`, `y = last ? last.top + sectionTargetHeight(last, visibleMembersOf(last)) : 0` (visible = nodes in `last.memberIds` not in `last.folded ?? []`), `next = insertLaneAt(lanes, y, now)`; set `title` when given; `d.metadata = { ...d.metadata, sections: next }`; `Object.assign(d, applyLaneFit(d, now))`; write; return `Created section S<index> (id …) at y=<y>`.
- [ ] `canvasRemoveSection(args)`: lane by `sectionByRef` (error `'error: no section matches <ref>'`); `doomed = new Set(deriveLanes(d.nodes, lanes).find(l => l.id === lane.id).memberIds)` (pinned included); `d.nodes = d.nodes.filter(n => !doomed.has(n.id))`; `d.edges` filtered on both ends; `sections = parkFirstLaneAtOrigin(pruneFoldedIds(lanes.filter(l => l.id !== lane.id), doomed))`; fit; write; return `Removed section S<n> and <k> node(s)`.
- [ ] `canvasUpdateSection(args)`: lane by ref; `title` (string; `''` clears → delete the key); `kernelRef` (`null` → delete the key; a string → `kernelByRef(d, ref)` or error); `folded` (`true` → `foldLane(lanes, d.nodes, id)`; `false` → `const u = unfoldLane(lanes, d.nodes, id)`; apply `u.nodeShifts` to `d.nodes` and take `u.lanes`); then fit; write; return a one-line summary of what changed.
- [ ] Register the three tools (descriptions: state the shared rules in one sentence each — fit, clamp, "nodes and edges of the section are deleted", "folding hides its nodes; unfolding grows the section back before releasing them") and dispatch cases. typecheck, build; commit `feat: MCP canvas_add_section / canvas_remove_section / canvas_update_section on the rail's rules`.

---

### Task 4: `canvas_run_section`, `canvas_add_kernel`, `canvas_remove_kernel`

**Files:** `src/extension/mcp/server.ts`

- [ ] Factor the kernel/server/ipc resolution out of `canvasRunCell` into `prepareRun(d, cell, kernelRef?): { kernel, kernelId, server, ipc } | string` (the error text unchanged), and use it in `canvasRunCell` (behaviour identical — the upstream loop stays there).
- [ ] `canvasRunSection(args)`: lane by ref; `order = memberCodeCellsInRunOrder(d.nodes, lanes, lane.id)`; empty → `'error: no code cells in S<n>'`; loop: re-read the cell from `d.nodes` each turn, `prepareRun(d, cell)` (error → return with what ran), `runCellCore(...)`, stop at the first `'error'`; return `ran E1:ok, E2:ok` style summary.
- [ ] `canvasAddKernel(args)`: `servers = resolveKernelConfig()`-style lookup as `canvasRunCell` does (`loadKernelServersFromEnv`? — reuse whatever `canvasRunCell` uses to find `server`); `server` arg required (error listing the known names); `spec` optional; `start` default true → `startKernel(server, spec ?? 'python3')` from `'../jupyter/client'` → `kernelId`; record `{ id: k-…, server, spec, displayName: args.displayName ?? spec ?? 'kernel', kernelId, colorIndex: nextKernelColorIndex(records + kernel nodes) }` (import `nextKernelColorIndex` from `'../../shared/kernelPalette'`); `bindSection` → set the lane's `kernelId`; write; return the record id + live id.
- [ ] `canvasRemoveKernel(args)`: record by ref (records only — a node ref → `'error: <ref> is a kernel node; remove it with canvas_remove_node'`); if `kernelId` and the server is known → `shutdownKernel(server, kernelId)` (ignore errors); `bound = resolveKernelCellsInCanvas(rec.id, cellKernelView(d))` BEFORE unbinding; clear `lastStatus` on them; remove the record; drop `kernelId` from lanes naming it (destructure); write; return the summary.
- [ ] Register + dispatch; typecheck, build; commit `feat: MCP canvas_run_section, canvas_add_kernel, canvas_remove_kernel`.

---

### Task 5: probe + verification + package

**Files:** `test/mcp-parity.mjs` (gitignored), `package.json`

- [ ] Write `test/mcp-parity.mjs`: spawns `node dist/mcp-server.js` with stdio JSON-RPC (mirror the approach the Task 4 kernels implementer used), creates scratch canvases under `test/.scratch/`, and asserts the written files after: add_section (append + at y), update_section (rename, bind a record, fold → lists members and shrinks, unfold → round trip), remove_section, add_node at (-403, -99) → clamped to (0, 0) and a section seeded, layout past a bottom edge → sections below shift, add_kernel with `start: false` (no server needed) + bind, remove_kernel → unbound + run flags cleared. Run: `node --test test/mcp-parity.mjs`.
- [ ] All suites; typecheck; build; bump `package.json`; `npm run package`; commit the bump. Done as `0.17.7` (`8298e4a`).

---

## Self-review

Spec §1 rules → Tasks 2 (clamp), 3/4 (fit/fold/pin/prune/order/kernel through the shared functions); §2 tools → Tasks 3–4; `canvas_list`/`canvas_read` → Task 2; §3 open panel → nothing to build; §4 tests → Tasks 1, 5. Names used consistently: `sectionByRef`, `insertLaneAt`, `foldLane`, `unfoldLane`, `prepareRun`, `kernelByRef`.
