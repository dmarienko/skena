# Typst Math in Markdown — Design

**Date**: 2026-07-13
**Status**: approved (brainstormed with user); spike passed
**Branch**: `feature/typst` (off `main`)
**Feature**: render Typst math embedded in markdown via a `%…%` delimiter, everywhere markdown
renders — chat, inline text nodes, and `.md` file nodes. `$…$` stays LaTeX (KaTeX), unchanged.

Scope note: whole-`.typ`-document file nodes (Goal A in the estimate) are a SEPARATE later spec.
This spec is math-in-markdown only.

## Decisions (locked)

- **Delimiter**: `$…$` / `$$…$$` = LaTeX (KaTeX, unchanged); `%…%` = inline Typst, `%%…%%` = block
  Typst. Distinct delimiter so existing LaTeX is untouched.
- **Path**: host-side `@myriaddreamin/typst-ts-node-compiler` (NOT WASM). Spike (2026-07-13)
  confirmed it loads on the remote host, renders math to SVG in 11 ms cold / 2 ms warm, fonts
  bundled (no font packaging). See `crtx/knowledge/skena-typst-support-estimate-2026-07-13.md`.
- **Chat**: streams in the webview as today; a completed message containing `%…%` is re-rendered
  host-side (HTML with Typst SVGs) and swapped in. Messages without `%` are untouched.
- **Text nodes**: view mode renders host HTML when the text contains `%…%`, else webview as today.
- **`.md` file nodes**: already host-rendered → adding the Typst step to `markdown-html.ts` makes
  `%…%` work there with zero webview change.

## Background (FACT)

- `.md` file nodes are rendered to HTML on the extension host via `src/extension/markdown-html.ts`
  (unified: remark-parse → gfm → math → remark-rehype → rehype-katex → hast-util-to-html).
- Text nodes (view mode) and chat render markdown IN the webview via ReactMarkdown + remark-math +
  rehype-katex. The host renderer never touches these — the reason Typst can't reach them for free.

## 1. Host: Typst compile + markdown pipeline

**`src/extension/typst.ts`** (new): a `NodeCompiler` singleton wrapper.
```
getTypstCompiler(): NodeCompiler   // - lazy singleton (NodeCompiler.create())
typstMathToSvg(src: string, block: boolean): string   // - wrap src in a page, compile → SVG
```
Wraps the snippet as `#set page(width: auto, height: auto, margin: 2pt, fill: none)\n` + (block
`$ … $` display / inline `$…$`), calls `compiler.svg({ mainFileContent })`, returns the SVG string.
On a compile error, returns a small inline error `<span>` (never throws into the pipeline).

**`markdown-html.ts`**: add a custom unified step `remarkTypstMath` BEFORE `remark-rehype` that finds
`%…%` (inline) / `%%…%%` (block) spans in the MDAST text and replaces them with an `html` node
containing the compiled SVG (via `typstMathToSvg`). Runs alongside the existing remark-math/katex
(they own `$`, this owns `%`), so both math engines coexist.

**Delimiter parsing (collision-aware).** `%` is common in prose ("50% off"), so mirror remark-math's
`$` rules: an opening `%` must be immediately followed by a non-whitespace char, a closing `%` must
be immediately preceded by a non-whitespace char, inline spans do not cross a newline, and an empty
`%%` is not math. `%%…%%` (block) is matched first. (OPEN QUESTION for review — see end.)

## 2. Host message: render arbitrary markdown → HTML

`markdown-html.ts` already renders `.md` files. Add a webview→host request so text nodes and chat
can get the same host HTML for a raw string:

- `MsgRenderMarkdown { type: 'renderMarkdown'; requestId: string; text: string }` (webview → host)
- `MsgRenderMarkdownResult { type: 'renderMarkdownResult'; requestId: string; html: string }` (host → webview)

Host handler calls `renderMarkdownToHtml(text)` (the existing singleton pipeline, now Typst-aware)
and replies. Errors → reply with a safe error HTML string (never reject).

## 3. Webview: on-demand host render (chat + text nodes)

A small hook **`useHostMarkdown(text)`** (`src/webview/hooks/useHostMarkdown.ts`):
- If `text` contains no `%` → return `null` (caller renders with ReactMarkdown as today; zero cost).
- Else → request `renderMarkdown` from the host (debounced/deduped by content), return the HTML when
  it arrives. Cache by a content hash in a module-level `Map` so reopen/scroll/re-render don't
  re-request (host also has its own 2 ms warm cache; this avoids even the IPC round-trip).

**Chat (`FloatingChat.tsx` ChatBubble)**: for a completed message, `const html = useHostMarkdown(msg.content)`.
If `html` → render via `dangerouslySetInnerHTML` (KaTeX + Typst SVGs baked in); else → existing
ReactMarkdown path. Streaming partials always use ReactMarkdown (no `%…%` rendering mid-stream —
Typst appears when the reply completes; documented). User messages (no stream) render host HTML
immediately when they contain `%`.

**Text nodes (`TextNode.tsx` view mode)**: same — `useHostMarkdown(draft)`; host HTML when it
contains `%`, else the existing `MarkdownRenderer`.

**CSP**: host returns HTML with inline `<svg>` (no scripts, no external). Existing webview CSP
already allows inline SVG in the DOM — no CSP change (this is the whole point of the host path).

## 4. Caching

- Host: `NodeCompiler`'s built-in compile cache (2 ms warm) + the `renderMarkdownToHtml` singleton.
- Webview: `useHostMarkdown` memo cache keyed by content hash → one host round-trip per unique text.
- Invalidation: text changes → new hash → new render. No manual invalidation needed.

## Error handling

- Typst compile error on a `%…%` span → inline red error marker in place of that span; the rest of
  the doc renders. Never throws into the unified pipeline.
- Host render request failure / timeout (2 s) → webview falls back to ReactMarkdown (LaTeX still
  works; `%…%` shows raw). No blank content.
- `NodeCompiler.create()` fails to load (shouldn't — spike passed) → `typstMathToSvg` returns the
  raw snippet text; log once to the output channel.

## Packaging

- Add `@myriaddreamin/typst-ts-node-compiler` to deps. Ships a per-platform native binary via
  optionalDependencies. For remote-SSH / personal use: one platform (linux-x64), already verified.
  Marketplace publish for all users would need the other platform binaries bundled — out of scope
  here (same caveat as the estimate).
- Fonts are bundled in the compiler — nothing to package.

## Testing

- **Pure host unit** (`test/typst-math.mjs`, node --test): `typstMathToSvg('x^2', false)` → SVG with
  `<path>`; block vs inline; a malformed snippet → error marker, not a throw.
- **Delimiter unit** (`test/typst-delim.mjs`): the `%…%`/`%%…%%` matcher — matches valid spans,
  does NOT match "50% off", "a % b" (space-bounded), empty `%%`, or `%` across a newline.
- **Manual smoke**: `%…%` in a chat message → Typst renders on completion; `$…$` still KaTeX;
  same in a text node and a `.md` file node; a `%` in prose ("50%") stays literal; reopen chat →
  no re-flicker (cache hit).

## Out of scope (this spec)

- Whole `.typ` document file nodes (separate spec).
- Typst rendering of streaming partials (only completed messages render Typst).
- Non-math Typst in markdown (arbitrary Typst content blocks) — math delimiters only.

## Open questions (for review)

1. **`%…%` collision**: even with the strict rules, unusual prose (`%foo%bar`) could false-match.
   Acceptable with the rules as specified, or prefer a safer inline form (e.g. only `%%…%%` block +
   a fenced ` ```typst ` for larger snippets, no bare inline `%`)? Current spec: `%…%` inline +
   `%%…%%` block with strict boundary rules.
