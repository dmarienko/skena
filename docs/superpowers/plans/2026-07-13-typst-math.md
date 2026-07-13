# Typst Math in Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Typst math embedded in markdown via a `%…%` (inline) / `%%…%%` (block) delimiter — in `.md` file nodes, inline text nodes, and chat — while `$…$` stays LaTeX (KaTeX), per `docs/superpowers/specs/2026-07-13-typst-math-design.md`.

**Architecture:** Typst compiles **host-side** (extension host, Node) via `@myriaddreamin/typst-ts-node-compiler` (spike-verified: loads on remote host, fonts bundled, ~11 ms cold / 2 ms warm → SVG). A `remarkTypstMath` unified plugin in the existing `markdown-html.ts` turns `%…%`/`%%…%%` spans into inline SVG. `.md` file nodes get it for free (already host-rendered). Text nodes and chat request host HTML on demand (only when the text contains `%`) via a new `renderMarkdown` message + a `useHostMarkdown` hook, and swap it in via `dangerouslySetInnerHTML`; text without `%` renders in the webview as today.

**Tech Stack:** TypeScript, unified/remark/mdast (`unist-util-visit` available), React webview, VS Code extension host, esbuild, `node --test`.

**Conventions:**
- Comments `// -` terse; no banner comments; modern TS.
- `test/` is **gitignored** — run pure tests via esbuild bundle + `node --test`; never `git add` test files; inline fixtures.
- `npm run build` full build; `npm run typecheck` has **exactly 3 pre-existing errors** in `editor-provider.ts` `copyAbsolutePath` (`fsPath`) — introduce no new ones.
- Branch: `feature/typst` (verify `git branch --show-current`).

**Key facts (from the code):**
- `src/extension/markdown-html.ts` — host pipeline; TWO singleton processors: `buildLightProcessor` (no math) and `buildProcessor` (remark-math + rehype-katex, `output:'mathml'`); selected by `content.includes('$')`. `renderMarkdownToHtml(content, resolveImageUri?)` is the entry.
- `remark-typst` math compiles synchronously: `compiler.svg({ mainFileContent })` returns an SVG string directly (no await).
- ChatBubble (`FloatingChat.tsx:935-949`) renders `msg.content` via `<ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex,…]]}>`.
- TextNode view (`TextNode.tsx:660`) renders `<MarkdownRenderer content={draft} baseUri="." />`.
- editor-provider webview-message switch handles request/response pairs (e.g. `requestClipboardRead` → `clipboardContent`); `send(msg)` in scope.
- App.tsx uses `makeEventTarget<T>()` buses + a message switch (`case '…'`) + props to children.

---

### Task 1: Host Typst compiler wrapper (`typst.ts`)

**Files:**
- Create: `src/extension/typst.ts`
- Test: `test/typst-compile.mjs` (gitignored)
- Modify: `package.json` (dependency)

- [ ] **Step 1: Add the dependency**

```bash
cd ~/devs/skena
npm install @myriaddreamin/typst-ts-node-compiler@^0.7.0
```
Verify: `node -e "console.log(Object.keys(require('@myriaddreamin/typst-ts-node-compiler')).includes('NodeCompiler'))"` prints `true`.

- [ ] **Step 2: Write the failing test** — `test/typst-compile.mjs`

```js
// test/typst-compile.mjs
// - run: npx esbuild src/extension/typst.ts --bundle --platform=node --format=esm --outfile=test/.build/typst.mjs --external:@myriaddreamin/typst-ts-node-compiler && node --test test/typst-compile.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { typstMathToSvg } from './.build/typst.mjs';

test('inline math compiles to an SVG with glyph paths', () => {
  const svg = typstMathToSvg('x^2 + y^2', false);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path/);   // - real glyphs, not empty/tofu
});

test('block math compiles to an SVG', () => {
  const svg = typstMathToSvg('sum_(i=1)^n i', true);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path/);
});

test('malformed math returns an error marker, does not throw', () => {
  const out = typstMathToSvg('$ unterminated', false);
  assert.ok(typeof out === 'string');
  assert.doesNotMatch(out, /^<svg/);   // - not a valid render → error span
  assert.match(out, /typst-error/);
});
```

- [ ] **Step 3: Verify it fails**

```bash
npx esbuild src/extension/typst.ts --bundle --platform=node --format=esm --outfile=test/.build/typst.mjs --external:@myriaddreamin/typst-ts-node-compiler
```
Expected: esbuild FAILS — `src/extension/typst.ts` doesn't exist.

- [ ] **Step 4: Implement** — `src/extension/typst.ts`

```ts
// - host-side Typst compiler: compile a math snippet to a standalone inline SVG.
// - NodeCompiler bundles fonts + a warm compile cache (~2ms); one lazy singleton.
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';

let _compiler: NodeCompiler | null = null;

function compiler(): NodeCompiler {
  if (!_compiler) _compiler = NodeCompiler.create();
  return _compiler;
}

// - escape for safe embedding in an HTML text node (error path only)
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Compile a Typst math snippet to a self-contained inline SVG string.
 * `block` → display math (centered, larger); else inline. Never throws — a compile
 * failure returns a small error span so the surrounding document still renders.
 */
export function typstMathToSvg(src: string, block: boolean): string {
  // - auto-sized transparent page; wrap the snippet in Typst math mode
  const doc =
    '#set page(width: auto, height: auto, margin: 2pt, fill: none)\n' +
    (block ? `$ ${src} $` : `$${src}$`);
  try {
    const svg = compiler().svg({ mainFileContent: doc });
    if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) {
      return `<span class="typst-error">Typst: no output</span>`;
    }
    // - tag so the webview can style it (inline-block, vertical-align)
    return svg.replace('<svg', `<svg class="typst-math ${block ? 'typst-block' : 'typst-inline'}"`);
  } catch (e) {
    return `<span class="typst-error">Typst error: ${esc((e as Error).message).slice(0, 120)}</span>`;
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npx esbuild src/extension/typst.ts --bundle --platform=node --format=esm --outfile=test/.build/typst.mjs --external:@myriaddreamin/typst-ts-node-compiler && node --test test/typst-compile.mjs
```
Expected: 3 pass.

- [ ] **Step 6: Build + typecheck + commit**

```bash
npm run build && npm run typecheck
git add src/extension/typst.ts package.json package-lock.json
git commit -m "feat(typst): host-side NodeCompiler wrapper — math snippet → inline SVG"
```
Expected: build OK; typecheck only the 3 pre-existing errors.

---

### Task 2: `%…%` delimiter matcher (pure, TDD)

**Files:**
- Create: `src/extension/typst-delim.ts`
- Test: `test/typst-delim.mjs` (gitignored)

- [ ] **Step 1: Write the failing test** — `test/typst-delim.mjs`

```js
// test/typst-delim.mjs
// - run: npx esbuild src/extension/typst-delim.ts --bundle --format=esm --outfile=test/.build/typst-delim.mjs && node --test test/typst-delim.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findTypstSpans } from './.build/typst-delim.mjs';

// - findTypstSpans(text) → [{ start, end, body, block }] over the raw text
test('inline %..% is matched', () => {
  const s = findTypstSpans('area is %pi r^2% today');
  assert.equal(s.length, 1);
  assert.equal(s[0].body, 'pi r^2');
  assert.equal(s[0].block, false);
});

test('block %%..%% is matched and preferred over inline', () => {
  const s = findTypstSpans('%%sum_(i=1)^n i%%');
  assert.equal(s.length, 1);
  assert.equal(s[0].body, 'sum_(i=1)^n i');
  assert.equal(s[0].block, true);
});

test('"50% off" does NOT match (space after opening %)', () => {
  assert.deepEqual(findTypstSpans('50% off the price'), []);
});

test('"a % b" does NOT match (spaces both sides)', () => {
  assert.deepEqual(findTypstSpans('a % b % c'), []);
});

test('empty %% is not math', () => {
  assert.deepEqual(findTypstSpans('%% %'), []);
});

test('inline does not cross a newline', () => {
  assert.deepEqual(findTypstSpans('%x\ny%'), []);
});

test('two inline spans on one line', () => {
  const s = findTypstSpans('%a% and %b%');
  assert.deepEqual(s.map(x => x.body), ['a', 'b']);
});
```

- [ ] **Step 2: Verify it fails**

```bash
npx esbuild src/extension/typst-delim.ts --bundle --format=esm --outfile=test/.build/typst-delim.mjs
```
Expected: esbuild FAILS — file doesn't exist.

- [ ] **Step 3: Implement** — `src/extension/typst-delim.ts`

```ts
// - pure delimiter matcher for embedded Typst math; no unified/DOM deps. Unit-tested.
// - inline `%body%`, block `%%body%%`. Strict boundary rules to avoid prose collisions
// - with literal percent signs (mirrors remark-math's `$` rules):
// -   opening delimiter immediately followed by a non-space,
// -   closing delimiter immediately preceded by a non-space,
// -   inline spans do not cross a newline, empty body is not math.

export interface TypstSpan { start: number; end: number; body: string; block: boolean }

export function findTypstSpans(text: string): TypstSpan[] {
  const out: TypstSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '%') { i++; continue; }
    const block = text[i + 1] === '%';
    const open = block ? 2 : 1;
    const after = text[i + open];
    // - opening must be followed by a non-space, non-% char
    if (after === undefined || after === ' ' || after === '\t' || after === '%' || (!block && after === '\n')) { i += open; continue; }
    // - scan for the matching close
    const closeDelim = block ? '%%' : '%';
    let j = i + open;
    let found = -1;
    while (j < text.length) {
      if (!block && text[j] === '\n') break;             // - inline never crosses newline
      if (text.startsWith(closeDelim, j) && (block || text[j - 1] !== '%')) {
        const before = text[j - 1];
        if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '%') { found = j; break; }
      }
      j++;
    }
    if (found < 0) { i += open; continue; }
    const body = text.slice(i + open, found);
    if (body.trim()) out.push({ start: i, end: found + open, body, block });
    i = found + open;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

```bash
npx esbuild src/extension/typst-delim.ts --bundle --format=esm --outfile=test/.build/typst-delim.mjs && node --test test/typst-delim.mjs
```
Expected: 7 pass. If a boundary case fails, adjust the guard for that case ONLY and re-run (do not weaken the others).

- [ ] **Step 5: Commit**

```bash
git add src/extension/typst-delim.ts
git commit -m "feat(typst): pure %..% / %%..%% delimiter matcher with strict boundaries"
```

---

### Task 3: `remarkTypstMath` plugin + wire into `markdown-html.ts`

**Files:**
- Modify: `src/extension/markdown-html.ts`
- Test: manual (host render) — covered by Task 6 smoke; the pure pieces are already tested.

- [ ] **Step 1: Add the plugin + imports in `markdown-html.ts`**

Add imports at the top (next to the existing remark imports):

```ts
import { visit }           from 'unist-util-visit';
import { findTypstSpans }  from './typst-delim';
import { typstMathToSvg }  from './typst';
```

Add the plugin (a unified transformer) below the imports, before `buildLightProcessor`:

```ts
// - remark plugin: replace %..% / %%..%% spans in text nodes with raw HTML nodes
// - carrying the compiled Typst SVG. Splits each matched text node into
// - [text before][html svg][text after…]. Sync — NodeCompiler.svg() is synchronous.
function remarkTypstMath() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | null, parent: any) => {
      if (index === null || !parent || typeof node.value !== 'string') return;
      const spans = findTypstSpans(node.value);
      if (spans.length === 0) return;
      const out: any[] = [];
      let last = 0;
      for (const s of spans) {
        if (s.start > last) out.push({ type: 'text', value: node.value.slice(last, s.start) });
        out.push({ type: 'html', value: typstMathToSvg(s.body, s.block) });
        last = s.end;
      }
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;   // - skip the nodes we just inserted
    });
  };
}
```

- [ ] **Step 2: Add the plugin to BOTH processors + Typst-aware selection**

Change the processor selection and both builders. The light processor is used when there is no `$`; it must still run Typst if there is a `%`. Simplest: add `remarkTypstMath` to BOTH builders (it is a no-op when no `%`), and keep KaTeX only in the full builder. But `allowDangerousHtml` must be true on `remarkRehype` so the injected `html` (SVG) nodes survive — set it true (the SVG is compiler-generated, no user script; still passes through hast-util-to-html which does not execute anything).

In `buildLightProcessor`:
```ts
function buildLightProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkTypstMath)
    .use(remarkRehype, { allowDangerousHtml: true });   // - was false; needed for injected SVG html nodes
}
```

In `buildProcessor`:
```ts
function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkTypstMath)
    .use(remarkRehype, { allowDangerousHtml: true })    // - was false; injected SVG html nodes
    .use(rehypeKatex, { output: 'mathml', throwOnError: false } as any);
}
```

Update the fast-path selection so a `%`-only doc still hits a Typst-capable processor. Change:
```ts
  const hasMath = content.includes('$');
```
to:
```ts
  // - use the full processor when EITHER math engine is needed; light only for plain prose
  const hasMath = content.includes('$');
  const hasTypst = content.includes('%');
  const useFull = hasMath;              // - KaTeX only needed for '$'
  if (useFull || hasTypst) {
    if (!_processor) _processor = buildProcessor();
  } else {
    if (!_processorLight) _processorLight = buildLightProcessor();
  }
  const proc = (useFull || hasTypst) ? _processor! : _processorLight!;
```
Delete the old `if (hasMath) {…} else {…}` block and the old `const proc = …` line (this replaces them). (`buildLightProcessor` keeps `remarkTypstMath` too so it is correct even if reached, but with this selection the light path is only plain prose.)

Note on `allowDangerousHtml: true`: this permits raw HTML passthrough in general (not just our SVG). Existing markdown could contain raw HTML which was previously stripped. This matches the webview `MarkdownRenderer` which uses `rehype-raw` (raw HTML allowed), and the output still goes through `hast-util-to-html` (serialization only — no execution) under the webview CSP. Acceptable and consistent.

- [ ] **Step 3: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors. If `visit`'s types complain, the `any` params in the plugin already avoid strictness — keep them.

- [ ] **Step 4: Quick host sanity (node)**

```bash
npx esbuild src/extension/markdown-html.ts --bundle --platform=node --format=esm --outfile=test/.build/mdhtml.mjs --external:@myriaddreamin/typst-ts-node-compiler
node -e "import('./test/.build/mdhtml.mjs').then(async m => { const h = await m.renderMarkdownToHtml('inline %x^2% and block\n\n%%sum_(i=1)^n i%%\n\nlatex \$a^2\$ and 50% literal'); console.log('typst-math svgs:', (h.match(/typst-math/g)||[]).length); console.log('katex mathml:', /<math/.test(h)); console.log('50% literal intact:', h.includes('50%')); })"
```
Expected: `typst-math svgs: 2`, `katex mathml: true`, `50% literal intact: true`.

- [ ] **Step 5: Commit**

```bash
git add src/extension/markdown-html.ts
git commit -m "feat(typst): remarkTypstMath in host pipeline — %..% renders, $ stays KaTeX"
```

---

### Task 4: `renderMarkdown` host message + `useHostMarkdown` hook

**Files:**
- Modify: `src/shared/types.ts` (2 messages + unions)
- Modify: `src/extension/editor-provider.ts` (handler)
- Modify: `src/webview/App.tsx` (event bus + route)
- Create: `src/webview/hooks/useHostMarkdown.ts`

- [ ] **Step 1: Message types in `src/shared/types.ts`**

Near `MsgFloatingChatCompacting` add:
```ts
/** - webview → host: render arbitrary markdown text to HTML (Typst/KaTeX-aware) */
export interface MsgRenderMarkdown { type: 'renderMarkdown'; requestId: string; text: string; }
/** - host → webview: rendered HTML for a renderMarkdown request */
export interface MsgRenderMarkdownResult { type: 'renderMarkdownResult'; requestId: string; html: string; }
```
Add `MsgRenderMarkdown` to the webview→host union (with `MsgDropFiles` etc.) and `MsgRenderMarkdownResult` to the host→webview union (with `MsgFloatingChatDelta` etc.).

- [ ] **Step 2: Host handler in `editor-provider.ts`**

In the webview-message switch (next to `case 'dropFiles':`), add:
```ts
        case 'renderMarkdown': {
          try {
            const html = await renderMarkdownToHtml(msg.text);
            send({ type: 'renderMarkdownResult', requestId: msg.requestId, html });
          } catch (e) {
            // - never reject: return an error span; webview falls back to its own render
            send({ type: 'renderMarkdownResult', requestId: msg.requestId, html: `<span class="typst-error">render failed</span>` });
          }
          break;
        }
```
Confirm `renderMarkdownToHtml` is imported at the top of editor-provider (it is — used for `.md` file nodes). `msg` narrows via the union.

- [ ] **Step 3: Route the result in `App.tsx`**

The result is request/response keyed by `requestId` — simplest is a window CustomEvent (like `skena:panelActivated`), so any hook instance can listen. In the message switch add:
```ts
        case 'renderMarkdownResult':
          window.dispatchEvent(new CustomEvent('skena:renderMarkdownResult', { detail: { requestId: msg.requestId, html: msg.html } }));
          break;
```

- [ ] **Step 4: The hook** — `src/webview/hooks/useHostMarkdown.ts`

```ts
// - returns host-rendered HTML for `text` ONLY when it contains a `%` (Typst delimiter);
// - otherwise null so the caller renders with its usual in-webview markdown (zero cost).
// - Caches by text so reopen/scroll/re-render don't re-request; the host also caches.
import { useEffect, useRef, useState } from 'react';

const cache = new Map<string, string>();   // - text → html
let seq = 0;

function post(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function useHostMarkdown(text: string): string | null {
  const needs = text.includes('%');
  const [html, setHtml] = useState<string | null>(() => (needs ? cache.get(text) ?? null : null));
  const reqRef = useRef<string>('');

  useEffect(() => {
    if (!needs) { setHtml(null); return; }
    const cached = cache.get(text);
    if (cached !== undefined) { setHtml(cached); return; }
    const requestId = `md-${++seq}`;
    reqRef.current = requestId;
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ requestId: string; html: string }>).detail;
      if (d.requestId !== requestId) return;
      cache.set(text, d.html);
      if (reqRef.current === requestId) setHtml(d.html);
    };
    window.addEventListener('skena:renderMarkdownResult', onResult);
    post({ type: 'renderMarkdown', requestId, text });
    // - 2s fallback: give up → null → caller uses in-webview render
    const t = setTimeout(() => { if (reqRef.current === requestId) setHtml(null); }, 2000);
    return () => { window.removeEventListener('skena:renderMarkdownResult', onResult); clearTimeout(t); };
  }, [text, needs]);

  return needs ? html : null;
}
```

- [ ] **Step 5: Build + typecheck + commit**

```bash
npm run build && npm run typecheck
git add src/shared/types.ts src/extension/editor-provider.ts src/webview/App.tsx src/webview/hooks/useHostMarkdown.ts
git commit -m "feat(typst): renderMarkdown host message + useHostMarkdown hook"
```
Expected: build OK; only the 3 pre-existing errors.

---

### Task 5: Wire into ChatBubble + TextNode view + Typst SVG styling

**Files:**
- Modify: `src/webview/canvas/FloatingChat.tsx` (ChatBubble)
- Modify: `src/webview/canvas/nodes/TextNode.tsx` (view render)
- Modify: `src/webview/styles/markdown.css` (typst-math sizing)

- [ ] **Step 1: ChatBubble — swap to host HTML when it contains `%`**

In `FloatingChat.tsx`, import the hook near the top: `import { useHostMarkdown } from '../hooks/useHostMarkdown';`.

In `ChatBubble`, before the `return`, add:
```ts
  // - completed messages with Typst (%..%) render host-side HTML; streaming + plain use ReactMarkdown
  const hostHtml = useHostMarkdown(streaming ? '' : msg.content);
```
Replace the `<ReactMarkdown …>{msg.content}</ReactMarkdown>` block with:
```tsx
        {hostHtml !== null ? (
          <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: hostHtml }} />
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { output: 'mathml', throwOnError: false }]]}
            components={{
              p: ({ children }) => <p style={{ margin: '0 0 4px 0' }}>{children}</p>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                return isBlock
                  ? <pre style={{ margin: '4px 0', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', borderRadius: 3, overflow: 'auto' }}><code style={{ fontSize: 11 }}>{children}</code></pre>
                  : <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.25)', padding: '0 3px', borderRadius: 2 }}>{children}</code>;
              },
            }}
          >
            {msg.content}
          </ReactMarkdown>
        )}
```
(`streaming ? '' : msg.content` → hook returns null while streaming, so the live partial always uses ReactMarkdown; on completion the `msg.content` is passed and host HTML swaps in if it has `%`.)

- [ ] **Step 2: TextNode view — same swap**

In `TextNode.tsx` import the hook: `import { useHostMarkdown } from '../../hooks/useHostMarkdown';`. Near the other view hooks add `const hostHtml = useHostMarkdown(draft);`. Replace the view-mode `<MarkdownRenderer content={draft} baseUri="." />` with:
```tsx
          {hostHtml !== null
            ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: hostHtml }} />
            : <MarkdownRenderer content={draft} baseUri="." />}
```
(This must be inside the existing `<ScrollableContent>`; keep that wrapper.)

- [ ] **Step 3: Typst SVG styling** — append to `src/webview/styles/markdown.css`

```css
/* - Typst math SVGs from the host renderer */
.typst-math.typst-inline { display: inline-block; vertical-align: -0.25em; height: 1.1em; width: auto; }
.typst-math.typst-block  { display: block; margin: 6px auto; max-width: 100%; }
.typst-error { color: #F87171; font-size: 0.9em; font-family: monospace; }
```

- [ ] **Step 4: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/FloatingChat.tsx src/webview/canvas/nodes/TextNode.tsx src/webview/styles/markdown.css
git commit -m "feat(typst): render Typst in chat + text nodes; typst-math SVG styling"
```

---

### Task 6: Manual smoke + release chores

**Files:**
- Modify: `README.md`, `package.json`

- [ ] **Step 1: Manual smoke (Extension Development Host)**

1. `.md` file node containing `inline %x^2% and block %%sum_(i=1)^n i%%` → both render as Typst SVGs; `$a^2$` still KaTeX; `50% off` stays literal. ✓
2. Text node with `%pi r^2%` in view mode → Typst SVG; edit mode shows raw text. ✓
3. Chat: send a message with `%e^(i pi) + 1 = 0%` → Typst renders when the message settles; `$…$` still KaTeX; a message without `%` renders instantly as before (no flicker). ✓
4. Assistant reply containing `%…%` → renders on completion. ✓
5. Reopen the chat / scroll → no re-flicker (cache hit). ✓
6. A malformed `%\sum%`-style snippet → inline red error marker, rest of the doc fine. ✓

- [ ] **Step 2: README** — under the AI companion / rendering section, add:

```markdown
- **Typst math** — write `%…%` (inline) or `%%…%%` (block) for [Typst](https://typst.app) math anywhere markdown renders (chat, text nodes, `.md` files). `$…$` stays LaTeX (KaTeX). Compiled on the extension host — no bundle bloat, fonts included.
```

- [ ] **Step 3: Version bump + package**

Bump `package.json` `version` minor (e.g. `0.6.19` → `0.7.0`), then:
```bash
npm run package 2>&1 | tail -3
```
Expected: `skena-0.7.0.vsix` builds clean; it now includes the `@myriaddreamin/typst-ts-node-compiler` native binary (VSIX size grows). Confirm the native `.node` is bundled: `npx vsce ls 2>/dev/null | grep -i typst | head`.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "chore(release): v0.7.0 — Typst math in markdown"
```

- [ ] **Step 5: Update crtx wiki**

Append to `~/projects/crtx/log.md` + `~/projects/crtx/projects/skena.md`: Typst math built per spec (host node-compiler, `%…%`/`%%…%%`, host-render-on-demand for chat/text nodes, `.md` free); note the pure modules (`typst-delim`, `typst`) + tests; flag marketplace multi-platform packaging still deferred. Commit the wiki.

---

## Self-review (done at plan time)

- **Spec coverage**: §1 host compiler → Task 1; §1 remark plugin + pipeline → Task 3; delimiter rules → Task 2 (tested); §2 renderMarkdown message → Task 4; §3 useHostMarkdown + chat/textnode wiring → Tasks 4/5; §3 CSP (inline SVG only) → no change, styling in Task 5; §4 caching (host warm + webview map) → Tasks 1/4; error handling (compile error span, 2s fallback, load fail) → Tasks 1/4; packaging (dep, fonts bundled, multi-platform deferred) → Tasks 1/6; testing → Tasks 1/2 pure + Task 6 smoke.
- **Type/name consistency**: `typstMathToSvg(src, block)` defined Task 1, used Task 3. `findTypstSpans → {start,end,body,block}` defined Task 2, consumed Task 3. `MsgRenderMarkdown{requestId,text}` / `MsgRenderMarkdownResult{requestId,html}` defined Task 4, used in editor-provider + hook. `useHostMarkdown(text): string|null` defined Task 4, used Task 5. `.typst-math/.typst-inline/.typst-block/.typst-error` classes emitted in Task 1 + Task 3, styled in Task 5.
- **`allowDangerousHtml` flip** flagged explicitly (Task 3 Step 2) with rationale (matches webview rehype-raw; serialization-only under CSP).
- **No placeholders**: every code step complete; tests inline fixtures (test/ gitignored).
- **Delegated to implementer** (flagged inline): exact union member locations in types.ts; confirming `renderMarkdownToHtml` import already in editor-provider; `visit` return-index typing.
