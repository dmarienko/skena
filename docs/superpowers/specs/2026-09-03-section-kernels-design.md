# Section Kernels — kernels as canvas records, no nodes

**Status:** approved in scope 2026-09-03 (smoke item 6: "I don't need any kernel nodes — when I press
the kernel dot I need a select / create kernel dialog, then this kernel is connected to this section").
Extends `2026-09-02-section-rail-design.md` §6–§7 and the follow-ups spec.

**Goal:** a section's kernel is picked or created from the rail and lives in the canvas file as a
record, not as a node on the canvas. Kernel nodes keep working for edge-bound cells; nothing migrates.

## 1. Stored

```ts
// src/shared/types.ts
export interface KernelRecord {
  id: string;            // - "k-<base36 time>", stable
  server: string;        // - a skena.jupyter.kernels[].name
  spec?: string;         // - kernelspec to (re)launch from; a restart uses the same environment
  displayName?: string;  // - spec display name, or the attached kernel's name
  kernelId?: string;     // - live Jupyter kernel id once started / attached; absent = not running
  colorIndex: number;    // - into KERNEL_PALETTE, assigned at creation (next unused)
}
// canvas.metadata.kernels?: KernelRecord[]
```

`SectionLane.kernelId` may name a `KernelRecord.id` **or** (legacy) a kernel node id. Resolution
looks records up first, then nodes.

## 2. One shape for "a kernel", whoever holds it

```ts
// src/shared/kernelBinding.ts
export interface KernelLike { id: string; server: string; kernelId?: string; spec?: string; displayName?: string; colorIndex?: number }
export function kernelById(c: { nodes; metadata? }, id: string): KernelLike | null   // - record, else kernel node
```

`makeCellKernelResolver` returns the **kernel id** as today (record or node id); every host handler
that took a `KernelNode` takes a `KernelLike` from `kernelById` and reads only `server`,
`kernelId`, `spec`, `displayName`. Writing back the live `kernelId` after a start (as `runOneCell`
does on the node today) writes it to the record or the node, whichever the id names.

Sites: `runOneCell`, `handleComplete`, `handleInspect`, `handleInterruptCell`, `handleKernelAction`,
the dead-kernel sweep, MCP `canvas_run_cell` (`kernelRef` may also be a record id or its
display name), `canvas_list` (a `Kernels:` block: id, display name, server, live state).

## 3. Rail

**Kernel dot → `KernelPicker`** lists, in this order: the canvas's kernel records (dot in the
record's colour + live LED from `kernelStatus`: idle green / busy / dead grey / error red), then
legacy kernel nodes if any, then a separator and **New kernel…** and **none**.

**New kernel…** posts `{ type: 'addKernel', forSection: sectionId }`. The host shows the existing
QuickPick (per server: start a new kernel from a spec, or attach to a running one). On pick it
creates a `KernelRecord` (no node), assigns the next colour, binds the section
(`lane.kernelId = record.id`), saves, and replies `kernelAdded { sectionId, kernelId }`. Cancel =
nothing. (`addKernel` without `forSection` keeps creating a node, for the context menu.)

**Kernel actions** — the `SegmentMenu` gains, when the section has a kernel: Start · Interrupt ·
Restart · Shutdown (the same `kernelAction` message, whose `kernelNodeId` becomes `kernelRef`).
The dot's tooltip shows `display name · server · state`.

**Colour**: bound → `kernelColor(record.colorIndex)`; unbound → by stack index (follow-ups §2).

## 4. Run-with-upstream on section-bound chains

Today `resolveUpstreamChain` orients edges by distance from a kernel *node*; with no such node it
returns `[]`. New rule when the target's kernel is not reached through edges: the chain is the target's
edge-connected component walked through code cells only (a text node between two cells breaks it),
keeping only the cells that resolve to the **same kernel** as the target (a cell on another kernel
would run elsewhere for nothing; one with no kernel would abort the run); upstream = those members
ordered by `(y, x)` that come **before** the target; run in that order, then the target. Same skip of already-run
(`lastStatus === 'ok'`) cells as today.

## 5. Migration and compatibility

No migration. Existing kernel nodes stay nodes; a section bound to a node keeps working (§2 falls
back to nodes). `metadata.kernels` is created on first New kernel…. The MCP `readCanvas` fix
(`a280f7d`) already preserves `metadata`.

Deleting a record: from the picker (`Remove kernel…` on a record row, host confirm) — shuts it down
if live, unbinds every section pointing at it. Not in v1: moving a record between canvases.

## 6. Tests

Pure: `kernelById` (record wins over a node with the same id; node fallback; null); resolver with a
record-bound section; upstream by position (component, ordering, target excluded, non-code
excluded, already-run skipped). Manual: New kernel… from the dot → section stripe takes the colour,
a cell with no edge runs on it; Restart from the menu clears the run flags of the section's cells;
Shutdown greys the LED; reopen the file → the record and binding survive.

## 7. Out of scope

Removing kernel-node support; per-cell kernel override without edges; kernel records shared across
canvases.
