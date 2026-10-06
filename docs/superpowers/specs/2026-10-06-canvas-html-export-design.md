# Canvas HTML export — design

Branch `feature/spatial-notebook`, written at `eea4f96`. Plan: `docs/superpowers/plans/2026-10-06-canvas-html-export.md`.

Labels: FACT = read in the code or measured on 2026-10-06 (file:line or the run given); INFERENCE = my reading; GUESS = untested.

## Decisions (user)

- Export one `.canvas` to ONE static HTML file. First target: `/home/quant0/projects/factors/research/review/factors-essentials.canvas`.
- Entry points: the command **Skena: Export canvas to HTML** and the MCP tool `canvas_export_html(canvasPath, outPath?)`. No standalone script. skena's own renderers, so the page matches the canvas.
- Layout as on the canvas: each node at its x/y/width/height with its label (N1, E3, C7, W21…); sections drawn as frames with their titles, folded sections drawn unfolded with their members; edges as SVG arrows from `fromSide` to `toSide`, with their labels. Groups are not drawn.
- The page makes no network request: KaTeX CSS and fonts, plotly.min.js (once), images and code colours are inside the file.
- No interactivity beyond scrolling (plotly's own hover and zoom stay). No kernel, no code execution.
- Every node type with its content: text (markdown, LaTeX, Typst), code cells (as the canvas preview draws them), output cells (html / plotly / image / markdown), knowledge nodes (their stored text), file nodes (the linked file rendered), link nodes (URL as text and a plain link), portal, node reference, kernel and chat nodes.
- Read-only on the `.canvas` file.
- **Size does not matter** — the page is for sharing results. No content is cut to save bytes (whole papers, all fonts, plotly). Measures that keep the page responsive are kept when they cost no content.

## Defaults (the user can change these)

- Output path: the command opens a save dialog at `<canvas dir>/<canvas name>.html`; the MCP tool writes `outPath`, else that same path. An existing file is overwritten.
- Scale 1:1 in canvas pixels; the browser scrolls. The page's top-left is the top-left of everything drawn (nodes, section ranges, edge routes) minus a 40 px margin.
- Knowledge and file nodes: the whole stored content, in a scroll box of the node's size.
- Code cells: line numbers 1..n. (The canvas preview shows relative numbers, 1, 1, 2, 3 … with the cursor on line 1.)
- Knowledge node header: `fetched YYYY-MM-DD HH:MM` (the canvas shows "2h ago", which goes stale in a shared page).
- Colours: the `--vscode-*` variables of an open canvas webview of that VS Code window; with no canvas open, VS Code Dark Modern values (`FALLBACK_THEME`, approximate).
- Link nodes: no favicon and no YouTube thumbnail (both are network images on the canvas).
- Remote `http(s)` images inside markdown or cell html: fetched at export time and inlined; one that cannot be fetched shows its alt text and address.

## What the canvas uses, and what the export can reuse

- FACT: every node component imports `@xyflow/react` (Handle, NodeResizer, useStore) and posts to `window.vscodeApi`; `TextNode.tsx` and `CodeNode.tsx` mount Monaco; `KnowledgeNode.tsx` waits on window events. None of them renders outside the webview. The export writes their markup as strings (same classes, borders, header rows) and reuses the pure modules underneath.
- FACT: markdown has two paths on the canvas. The host renderer `renderMarkdownToHtml` (`src/extension/markdown-html.ts:147`) does remark-math + rehype-katex with **MathML** output (`markdown-html.ts:112`) and Typst SVG through the native `NodeCompiler` (`src/extension/typst.ts:17`). The webview's `MarkdownRenderer` does react-markdown + rehype-raw + rehype-katex with **HTML** output (`MarkdownRenderer.tsx:136`). `useHostMarkdown.ts:33` sends a text to the host when it contains `%`, or, under the factors theme, a fence. The export follows the same routing with a host copy of the webview pipeline (`renderMarkdownKatexHtml`).
- FACT (probe run): of the 75 text and knowledge nodes in factors-essentials, all 34 knowledge nodes contain `%` and take the host path; 33 text nodes take the webview path.
- FACT: code cells are drawn from pure modules: `codeCellShiki.ts` (shiki tokens of the `skena.code.theme`, alpha mixed over the editor background), `codeCellView.ts` (bracket colours by pair, magic decoration, runs). Both run in node (`tests/code-cell-shiki.mjs`). The export draws a `<pre>` from them. Under `skena.code.theme = factors` the canvas uses Monaco's python tokenizer (`codeCellTheme.ts:65`), which needs Monaco; the export uses shiki with the factors markdown palette instead (same colours by category, not the same tokens).
- FACT: output cells store `format` = `markdown | image | html | plotly` and `content` = text / data URI / figure JSON (`src/shared/types.ts:75-80`). The canvas plots with `{ responsive: true, displaylogo: false }` (`PlotlyRenderer.tsx:34`).
- FACT: knowledge images are `crtx://…/assets/…` addresses (124 in factors-essentials). Only the extension host has the server token; it fetches them through `KnowledgeService.asset` (`src/extension/knowledge/service.ts:87`).
- FACT: sections are stored as `{ id, y, title?, createdAt, folded?: string[], kernelId? }` (`sectionLanes.ts:17`); a section spans the full canvas width from its `y` to the next section's. A fold keeps the hidden members at their own y and shrinks the section to 100 px; `unfoldLane` (`sectionLanes.ts:218`) returns the shifts that undo it. FACT (probe run): unfolding S1–S4 of factors-essentials gives 6 sections, 0 overlapping node pairs, content 19,100 × 15,200 px.
- FACT: edges inside one section are routed together by `routeSection` (`edgeRouting.ts:692`) as `CanvasView.tsx:934` runs it; any other edge goes through `routeOrthogonal` (`webview/canvas/routing/orthogonal.ts:112`) from `LabeledEdge.tsx:181`. Both are pure; the second imports only React Flow's `Position` enum, whose values are the JSON Canvas side names. FACT (probe run): factors-essentials after unfolding: every edge inside one section, 0 fallbacks, 106 ms.

## The MCP server

- FACT: `.mcp.json` starts it as `node .vscode/skena-mcp.js` from the workspace folder (`/home/quant0/projects/factors/.mcp.json`); the AI companion starts it with `SKENA_JUPYTER_KERNELS` and `SKENA_RUN_IPC` (`llm-adapters/harness.ts:298-300`). The bundle has no externals (`esbuild.config.mjs`, `mcpServerConfig`).
- FACT: bundling `markdown-html.ts` with no externals fails (`No loader is configured for ".node" files`). With the Typst package external, `require` resolves from the skena repo's `.vscode/` but not from `/home/quant0/projects/factors/.vscode/`: there Typst prints "Typst not available on this platform".
- FACT: the factors workspace's `.vscode/settings.json` has no `skena.*` key and the server's machine settings have none. INFERENCE: `skena.code.theme`, `skena.markdownTheme` and the knowledge server token come from user settings on the VS Code client, which a separate node process cannot read.
- Therefore the MCP tool does not render. It asks the running extension over the existing 127.0.0.1 relay (`src/extension/run-ipc.ts`), which gets a `/export` route. An MCP server from `.mcp.json` has no `SKENA_RUN_IPC`, so the extension writes the relay's `port:token` to `skena-ipc-<hash of the workspace folder>.json` in the OS temp dir (mode 0600) and removes it on dispose. Without a running extension the tool returns an error that says so.

## Architecture

- `src/shared/exportLayout.ts` (pure): groups out, labels ensured, folded sections unfolded, sections derived, page box.
- `src/extension/export/` (no `vscode` import except `exportCommand.ts`): `edges.ts` (routes, colours, arrows), `nodeHtml.ts` (one builder per node type), `codeHtml.ts`, `markdown.ts` (routing), `html.ts` (escaping, removal of scripts and remote loads, image swap, per-node HTML balancing), `page.ts` (theme variables, section frames, SVG edge layer, plotly), `shikiHost.ts`, `exportCanvas.ts` (reads the file, renders node by node, inlines images, returns the page), `offlineCheck.ts`.
- Build: `scripts/build-export-assets.mjs` writes `dist/export-assets/{katex,codicon,ibm-plex,skena}.css` (KaTeX woff2 and the codicon font as data URLs), because the VSIX ships `dist/` and not `node_modules` or `src` (`.vscodeignore`). plotly comes from the existing `dist/plotly.min.js`.
- Command and relay: `exportCommand.ts` reads the settings, asks an open canvas webview for its `--vscode-*` variables (`exportThemeRequest` / `exportThemeResult`), fetches knowledge images through the provider's `KnowledgeService`, writes the file. The MCP tool posts `{ canvasPath, outPath }` to `/export`.
- Responsiveness: each node box has `content-visibility: auto`, so the browser lays out and paints only nodes near the view; every node's content is in the file. Plots are drawn when their cell comes within 1000 px of the view. The export yields to the extension host between nodes.
- Every node's HTML is parsed and written back (rehype-raw) before it goes on the page: on the canvas each node's html is set through `innerHTML`, which closes what it opens; one static page has no such boundary, and `capOutputHtml` cuts long html at a byte count.

## Risks, with numbers (factors-essentials, measured 2026-10-06 with the code in the plan, outside VS Code, Typst from the repo's node_modules)

- The canvas grew while I worked on it (4.39 MB file, 126 nodes, 115 edges at the export run; 90 / 81 in the request).
- FACT: page 14.0 MB (`skena.markdownTheme` vscode) / 14.1 MB (factors) without the 124 knowledge images (that run had no knowledge server; their size is not known). Of the factors run: plotly.min.js 4.56 MB, knowledge nodes 5.29 MB, output cells about 1.8 MB (images 0.62, html 0.35, figure JSON 0.65), text nodes 1.06 MB, CSS 0.72 MB (KaTeX 0.37, codicons 0.20, IBM Plex 0.11, skena 0.04), file nodes 0.35 MB, code cells 0.27 MB.
- FACT: 171,471 elements (parse5); all 126 node boxes are direct children of the page container; 0 remote loads (`offlineCheck`).
- FACT: export time 9.6 s (rendering 8.6 s, HTML balancing about 1 s). The longest single node, W25, takes 2.4 s in the host renderer, during which the extension host does nothing else. Knowledge images add 124 server requests (time not measured).
- Browser load time and scrolling are not measured (no browser on this server). GUESS: 1–3 s to parse; then only nodes near the view are laid out.
- FACT: `dist/extension.js` (production) 1.30 MB → 3.85 MB (shiki core, its 54 themes, 10 grammars, the oniguruma wasm, rehype-raw). `skena-mcp.js` 153.8 KB → 156.4 KB.
- FACT: the page is 19,280 × 15,480 px at 1:1 (nodes, sections, edge routes and the margin); an overview needs the browser's zoom-out.
- The MCP tool needs a running VS Code window with skena active in that workspace.
- The export reads the file on disk; an edit still in the webview's save debounce is not in it.
- MathML (host path) uses the browser's math font, KaTeX HTML uses KaTeX's fonts — the canvas mixes both the same way.
- FACT: `tests/typst-compile.mjs` already fails at `eea4f96` (2 of 3): its ESM bundle has no `require`. The new tests that need Typst bundle with a `createRequire` banner.

## Open questions

1. MCP without VS Code: error (this design), or the MCP server renders itself (Typst addon from the installed extension's path written next to `skena-mcp.js`; settings only from workspace files, so no user-level code theme, markdown theme or knowledge token; +2.5 MB bundle).
2. Code cells under `skena.code.theme = factors`: shiki in the factors palette (this design), or port Monaco's Monarch python tokenizer to the host.
3. Code cell line numbers: 1..n (this design) or the canvas's relative numbers.
