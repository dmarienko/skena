# Spatial Notebook v1: plan vs. build (review 2026-10-09)

Plan: `2026-09-01-spatial-notebook-design.md` + crtx `plans/skena-layout-ux-redesign-2026-08-19.md`. Code: `feature/spatial-notebook` at `45d18e4`.
Tests, FACT (`node --test` on esbuild bundles in a scratch copy): bounds 10, section-lanes 50, layout-engine 154, edge-routing 23, spatial-nav 61, rail-geometry 13, kernel-binding 19, kernel-upstream 12, node-ref 11, g-chord 5; 0 fail.

## §1 Slot grid
- Move/resize snap to the grid: DONE. FACT `constants.ts:21` GRID 100, `grid.ts:12` snapGrid. Note: code heights step 50 px (`constants.ts:131`).
- Portrait golden-ratio slots: NOT DONE. FACT one square GRID for both axes; no decision found (FACT grep "portrait|golden" in log, project page, decisions).
- Per-type widths as slot counts (doc 4, code 3): NOT DONE. FACT `constants.ts:39-40` text and code both 700 wide.

## §2 Bounded canvas
- Origin (0,0), clamp, grows right/down: DONE. FACT `bounds.ts:15,35`; d60bb94, 1372d86. Note: one-grid margin left only, top flush (rail decision 2026-09-02).
- Normalize negative-space canvases on open: DONE. FACT `bounds.ts:49`, called `editor-provider.ts:103`; 077fa97.
- `Home`: DONE. FACT `CanvasView.tsx:3010`. Note: pans to the content's top-left, zoom kept.

## §3 Section
- Kernel-tinted band, open right: DROPPED-BY-DECISION. FACT virtual-sections spec R8 "No background fill on the section"; colour is the rail stripe.
- Header in the flow (fold, title, time, LED, #S, delete): DROPPED-BY-DECISION. FACT `decisions/skena-section-rail-2026-09-02.md` "Rail, not header"; controls in `rail/RailSegment.tsx`.
- Every node in a section: DONE. FACT membership by y, top lane clamps (`sectionLanes.ts:82`); first node seeds a lane (follow-ups §7). Note: group nodes are not members (70956d8).
- Addressable `x.canvas#S3`: DONE. FACT `nodeRef.ts:33`, b08c639.
- Fold, title survives: DONE. FACT folded lane = one grid, band draws title + node count (`SectionSeparators.tsx:25-34`). Note: that text scales with zoom.
- Delete: DONE. FACT `CanvasView.tsx:1229` (confirm when non-empty, undoable).

## §4 Layout engine
- No overlap, one-grid gap, insert/remove reflow: DONE. FACT `layoutEngine.ts:762` layoutSection, `:947` reflowSection. Note: a node in the way moves by the overlap, right or down only (decision page).
- Drag & drop recomputes: PARTLY. FACT engine runs after a drop (`CanvasView.tsx:1436`). Missing: snapping a dropped cell into a column (engine spec §4 "Phase 2 rules (recorded, not built)").
- Resize reflows neighbours, section grows: DONE. FACT `CanvasView.tsx:3613`, `sectionLanes.ts:176` fitLanes.
- Code cell grows/shrinks with its lines, capped: DONE. FACT `layoutEngine.ts:59`, 100 to 900 px (`constants.ts:129-131`).
- Output stuck to its code: DONE. FACT drag carries it (`CanvasView.tsx:1403-1415`), `layoutEngine.ts:1096` placeOutput.
- Empty output, no cell: DONE. FACT `editor-provider.ts:1862` hasVisibleOutput.
- Output starts wider than code, grows to a max width: PARTLY. FACT created 600 x 300 (`layoutEngine.ts:1102`), narrower than a 700 code cell; 1400 cap on resize only (`CanvasView.tsx:3593`). Missing: width from content (decision page "no content measurement yet").
- Down / output right / fork columns: DONE. FACT `layoutEngine.ts:1030` insertAfter, `:1072` forkOf.
- Notes go anywhere: DROPPED-BY-DECISION. FACT engine spec line 11 "2026-09-10: the hybrid model is dropped. Every node is a column member".

## §5 Connections
- Each edge separate, orthogonal through the gaps: DONE. FACT `edgeRouting.ts:692` routeSection, per section at `CanvasView.tsx:967`; 7df5bd1.
- Colour by kind: DROPPED-BY-DECISION. FACT edges spec §3: colour = source node border, only code to output dotted (`LabeledEdge.tsx:64,169`).
- Sequence edges drawn by the engine: PARTLY. FACT `o` adds a bottom-to-top edge (`CanvasView.tsx:3787`); re-wire on move "deliberately not built" (edges spec §6).
- Context edges = paragraph-anchored links: NOT DONE. FACT edges spec §6 lists them as later.
- Execution independent of edges: PARTLY. FACT an edge to a kernel node still wins over the section kernel (`kernelBinding.ts:111-128`); an unconnected cell runs on its section kernel.
- Run-with-upstream: DONE. FACT `kernelBinding.ts:168`. Note: on a section kernel the order is (y, x), not edge direction.
- Run all in topological order: DONE, built differently. FACT `sectionLanes.ts:351` orders by y then x, runs every cell, stops at the first error.
- `gf` follow: DONE as `g` + a label per connection. FACT `gChord.ts`, edges spec §4; preview cards 76d0535.
- crtx embedding links: NOT DONE. FACT edges spec §6.

## §6 Creating nodes
- `o` / `Alt+X j`, `Alt+X l` / `h` forks: DONE. FACT `CanvasView.tsx:2770-2772`. Note: right fork goes to the nearest code column past the output (user, 2026-09-30, engine spec §2).
- No `k` (nothing above): NOT DONE. FACT `Alt+X k` adds above (`layoutEngine.ts:1047` directionSlot 'K'); engine spec §2 lists it. No decision found.
- Edge `+` knob: NOT DONE. FACT nothing in `edges/LabeledEdge.tsx`; engine spec §4 "Out of scope: the edge + knob".
- Every creation through the engine: DONE. FACT runEngine at 20+ sites in `CanvasView.tsx`; MCP `after`/`forkOf` (`server.ts:670`).

## §7 Stack, create, move
- Append-only: PARTLY. FACT rail `+` appends (`CanvasView.tsx:1204`); MCP `canvas_add_section` with `y` inserts and splits (mcp-parity spec §2).
- Creation time: DONE. FACT `RailSegment.tsx:44,52`. Shared kernel = shared colour: DONE. FACT follow-ups §2, section-kernels spec §1.
- Add by button / MCP: DONE (FACT rail `+`; `server.ts:1986`). By dropping a doc on free canvas: NOT DONE. FACT `CanvasView.tsx:1703` onDrop only places file nodes.
- Move by drag or cut/paste, adopt kernel, output follows: DONE. FACT rail spec R6; kernel by membership `kernelBinding.ts:94`.
- Cross-section edges on move: PARTLY. FACT nothing is broken or re-wired (edges spec §0); upstream skips cells on another kernel (`kernelBinding.ts:196`).

## §8 Bird's-eye & minimap
- Labels keep screen size (kernel, time, count): PARTLY. FACT the rail is outside the flow; count only on folded bands (scales) and the Ctrl+M list (`MarksPanel.tsx:110`).
- Git-tree minimap, knob per section: NOT DONE. FACT rail spec §12 out of scope; `CanvasView.tsx:516` toggles React Flow's stock MiniMap.

## §9 Navigation
- Zoom only on deliberate keys: PARTLY. FACT cross-canvas jumps zoom out to fit (`CanvasView.tsx:1807`, follow-ups §8.2); otherwise only `z`/`Z` (`:2957,2994`), Ctrl+scroll, Alt+Shift+C.
- `hjkl` pan-to-focus: DONE. FACT `spatialNav.ts:92,192`. `` ` `` back, `m` marks, `/` search: DONE. FACT `CanvasView.tsx:3251,3240,2841` (marks jump with `` ` ``, not `'`).
- `[` / `]` section begin/end: DONE as `gg` / `G`. FACT `CanvasView.tsx:2909`, edges spec §4.
- Ctrl+U / Ctrl+D section up/down: NOT DONE. FACT `CanvasView.tsx:2942` scrolls the focused node.

## Piece plans
- FACT: 1a built (0.17.0); 1b withdrawn (virtual-sections spec l.3-5); rail 56/57, fit-fold 23/24, kernels 24/25 boxes ticked, the open box is the user's smoke; focus-reveal, layout-engine, mcp-parity, edges, knowledge-search, g-cards, chat console tick 0 boxes but are in code (52f5462, 7df5bd1, ecfd738, 76d0535, cc1ad20; `server.ts:1946-2026`).
- FACT open notes left in them: engine phase 2 and content output width; edges §6 exit order by turn vs. by other node, jog at a busy border end.

## NOT DONE / PARTLY, most depended-on first (order is INFERENCE)
1. Paragraph-anchored context edges + crtx embedding links: all of phase 4 and the third edge type of §5.
2. Output width from content: sets pair width and every push to the right.
3. Execution still bound by kernel-node edges; kernel nodes not removed.
4. Drag-and-drop column snap (engine phase 2).
5. Section minimap; count/kernel on open sections at overview zoom.
6. Edge `+` knob; drop-doc creates a section; Ctrl+U/D section keys.
7. Portrait slots and per-type widths; "no `k`" rule.

## Open questions never answered (FACT: no decision page or log line closes them)
- Slot pixel size and portrait slots (GRID 100 square since 0.16.28).
- Paragraph links: phase 2 or v1.
- Cross-section sequence edge: break on move or keep.
- Context-edge colour by group vs. manual: replaced by source-border colour; group colour never decided.
- FORK_1 bounded sideways preference (N about 3), and whether d&d phase 2 is still wanted.
- Node restyle spec (`2026-09-02-node-restyle-design.md`) never written.
- `Alt+X k` adds above, against the spec's append-only rule: keep or remove.
