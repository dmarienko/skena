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
import rehypeRaw           from 'rehype-raw';
import { toHtml }          from 'hast-util-to-html';
import type { Root }       from 'hast';
import { renderTypstSpans } from './typst-mdast';
import { typstMathToSvg }  from './typst';
import { normalizeMath } from '../shared/mathDelims';

// - remark plugin: replace %..% / %%..%% spans with raw HTML nodes carrying the compiled Typst SVG
// - (typst-mdast.ts). `file.value` must be the string the tree was parsed from: spans split by
// - emphasis are found by node offsets into it. Sync — NodeCompiler.svg() is synchronous.
function remarkTypstMath() {
  return (tree: any, file: any) => {
    renderTypstSpans(tree, typeof file?.value === 'string' ? file.value : '', typstMathToSvg);
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
  // - rewrite \(…\) / \[…\] LaTeX delimiters to $ / $$ so remark-math (which only knows $) renders
  //   math from exported papers that don't use dollar signs, and put a display $$ glued to text on
  //   its own line
  content = normalizeMath(content);
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

  // - the source goes to run() as the file, so remarkTypstMath reads the exact string parsed
  const hast = await proc.run(proc.parse(source), source);
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

// - the pipeline of the webview's MarkdownRenderer: react-markdown runs remark-gfm and remark-math,
//   keeps raw html (rehype-raw) and renders math with rehype-katex in HTML output. A node the
//   webview renders itself is rendered this way by the HTML export.
let _webviewProcessor: ReturnType<typeof buildWebviewProcessor> | null = null;

function buildWebviewProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .use(rehypeKatex, { output: 'html', throwOnError: false } as any);
}

/** Markdown to HTML as the webview's MarkdownRenderer renders it: KaTeX HTML output, no Typst. */
export async function renderMarkdownKatexHtml(content: string): Promise<string> {
  const source = normalizeMath(content);
  if (!_webviewProcessor) _webviewProcessor = buildWebviewProcessor();
  const hast = await _webviewProcessor.run(_webviewProcessor.parse(source));
  return toHtml(hast as Root);
}
