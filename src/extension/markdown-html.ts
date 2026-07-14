/**
 * Server-side markdown → HTML renderer for the extension host.
 *
 * Runs in Node.js (extension host process), completely off the webview UI thread.
 * The webview receives the finished HTML string and injects it via
 * dangerouslySetInnerHTML — zero JS parsing cost in the webview.
 *
 * Pipeline:
 *   remark-parse → remark-gfm → remark-math → remark-rehype → rehype-katex → hast-util-to-html
 *   (then optional image resolver walks the HAST before serialisation)
 *
 * Image resolution: relative `src` attributes in <img> nodes are rewritten to
 * vscode-resource:// URIs via a sync callback (panel.webview.asWebviewUri).
 * The browser fetches them natively — no base64, no large IPC messages.
 *
 * KaTeX CSS is already bundled into webview.css via `import 'katex/dist/katex.min.css'`
 * in index.tsx, so the KaTeX class names in the rendered HTML are properly styled.
 *
 * The processor is built once (module-level singleton) — unified's .process()
 * is stateless so it is safe to reuse across concurrent requests.
 */

import { unified }         from 'unified';
import remarkParse         from 'remark-parse';
import remarkGfm           from 'remark-gfm';
import remarkMath          from 'remark-math';
import remarkRehype        from 'remark-rehype';
import rehypeKatex         from 'rehype-katex';
import { toHtml }          from 'hast-util-to-html';
import type { Root }       from 'hast';
import { visit }           from 'unist-util-visit';
import { findTypstSpans }  from './typst-delim';
import { typstMathToSvg }  from './typst';

// - remark plugin: replace %..% / %%..%% spans in text nodes with raw HTML nodes
// - carrying the compiled Typst SVG. Splits each matched text node into
// - [text before][html svg][text after…]. Sync — NodeCompiler.svg() is synchronous.
function remarkTypstMath() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (index === undefined || !parent || typeof node.value !== 'string') return;
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
      return index + out.length;
    });
  };
}

// - Extract multiline Typst blocks fenced by a line that is exactly '%%', BEFORE markdown
// - parsing. remark would split such a block across text/break nodes (a trailing '\' is a
// - hard break), so the text-node visitor never sees it whole. Here we pull the block from
// - the raw source, compile it, and leave a sentinel paragraph; the SVG is swapped back in
// - after rendering, so it never passes through the markdown parser. Lines inside ``` / ~~~
// - code fences are skipped so a literal '%%' in a code block is left alone.
// - Single-line '%%x%%' and inline '%x%' are NOT touched here (their lines aren't bare '%%')
// - and stay with remarkTypstMath.
const TYPST_BLOCK_TOKEN = (i: number) => `zzztypstblk${i}zzz`;

function preRenderTypstBlocks(src: string): { text: string; blocks: string[] } {
  const lines = src.split('\n');
  const out: string[] = [];
  const blocks: string[] = [];
  let inCode = false;
  let fenceChar = '';
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const fence = trimmed.match(/^(```+|~~~+)/);
    if (fence) {
      if (!inCode) { inCode = true; fenceChar = fence[1][0]; }
      else if (trimmed[0] === fenceChar) { inCode = false; }
      out.push(lines[i]); i++; continue;
    }
    if (!inCode && trimmed === '%%') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '%%') j++;
      if (j < lines.length) {
        const body = lines.slice(i + 1, j).join('\n');
        out.push('', TYPST_BLOCK_TOKEN(blocks.length), '');   // - sentinel paragraph
        blocks.push(typstMathToSvg(body, true));
        i = j + 1; continue;
      }
      // - no closing '%%': leave the line as-is
    }
    out.push(lines[i]); i++;
  }
  return { text: out.join('\n'), blocks };
}

// - two singletons: light (no math) for prose-only docs, full (KaTeX) for math docs
// - KaTeX rendering is expensive (50-200 DOM nodes per equation); skip it entirely
// - when the content contains no '$' characters — typical for prose/research notes
let _processorLight: ReturnType<typeof buildLightProcessor> | null = null;
let _processor:      ReturnType<typeof buildProcessor>      | null = null;

function buildLightProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkTypstMath)
    .use(remarkRehype, { allowDangerousHtml: true });   // - was false; needed for injected SVG html nodes
}

function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)                              // - parse $...$ and $$...$$ in MDAST
    .use(remarkTypstMath)
    .use(remarkRehype, { allowDangerousHtml: true })    // - was false; injected SVG html nodes
    // - MathML output: browser's native math engine handles rendering.
    // - HTML output creates 100-200 <span> nodes per equation (KaTeX CSS spans);
    // - MathML output creates ~10 <math> nodes per equation that the browser
    // - renders natively. For a 500-equation document: ~100k → ~5k DOM nodes.
    // - VS Code's Electron (Chromium 118+) fully supports MathML Core.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .use(rehypeKatex, { output: 'mathml', throwOnError: false } as any);
}

/**
 * Walk a HAST tree and rewrite relative <img src> attrs via a sync resolver.
 * The resolver returns a vscode-resource:// URI produced by panel.webview.asWebviewUri
 * (pure string transformation, no I/O) so this is fully synchronous.
 */
function visitHastImages(node: any, resolveUri: (src: string) => string | undefined): void {
  if (node.type === 'element' && node.tagName === 'img') {
    const src = node.properties?.src;
    if (
      src &&
      typeof src === 'string' &&
      !src.startsWith('http://') &&
      !src.startsWith('https://') &&
      !src.startsWith('data:')
    ) {
      const resolved = resolveUri(src);
      if (resolved) node.properties.src = resolved;
    }
  }
  if (node.children?.length) {
    (node.children as any[]).forEach(c => visitHastImages(c, resolveUri));
  }
}

/**
 * Render markdown content to a safe HTML string.
 * Runs in the extension host Node.js process — never blocks the webview UI thread.
 *
 * @param resolveImageUri  Optional SYNC callback: given a relative image src,
 *   returns a vscode-resource:// URI string (or undefined to leave src unchanged).
 *   Using asWebviewUri keeps the HTML compact — no base64 blobs in the IPC message.
 */
export async function renderMarkdownToHtml(
  content: string,
  resolveImageUri?: (src: string) => string | undefined,
): Promise<string> {
  // - pre-extract multiline %%…%% Typst blocks (fence lines) before markdown parsing
  const { text: source, blocks } = content.includes('%%')
    ? preRenderTypstBlocks(content)
    : { text: content, blocks: [] as string[] };

  // - use the full processor when EITHER math engine is needed; light only for plain prose
  const hasMath  = source.includes('$');   // - KaTeX
  const hasTypst = source.includes('%');   // - Typst
  if (hasMath || hasTypst) {
    if (!_processor) _processor = buildProcessor();
  } else {
    if (!_processorLight) _processorLight = buildLightProcessor();
  }
  const proc = (hasMath || hasTypst) ? _processor! : _processorLight!;

  const hast = await proc.run(proc.parse(source));
  if (resolveImageUri) {
    visitHastImages(hast, resolveImageUri);
  }
  // - allowDangerousHtml: emit the injected raw <svg> (Typst) nodes verbatim instead of
  // - escaping them. Safe: SVG is compiler-generated (no script) and only serialized here.
  let html = toHtml(hast as Root, { allowDangerousHtml: true });
  // - swap the sentinels back to the compiled block SVGs (strip the <p> wrapper markdown adds)
  for (let k = 0; k < blocks.length; k++) {
    const token = TYPST_BLOCK_TOKEN(k);
    html = html.replace(`<p>${token}</p>`, blocks[k]).replace(token, blocks[k]);
  }
  return html;
}
