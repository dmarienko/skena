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

// - two singletons: light (no math) for prose-only docs, full (KaTeX) for math docs
// - KaTeX rendering is expensive (50-200 DOM nodes per equation); skip it entirely
// - when the content contains no '$' characters — typical for prose/research notes
let _processorLight: ReturnType<typeof buildLightProcessor> | null = null;
let _processor:      ReturnType<typeof buildProcessor>      | null = null;

function buildLightProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false });
}

function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)                              // - parse $...$ and $$...$$ in MDAST
    .use(remarkRehype, { allowDangerousHtml: false })
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
  // - two processors: skip KaTeX for files that contain no math syntax (fast path)
  const hasMath = content.includes('$');
  if (hasMath) {
    if (!_processor) _processor = buildProcessor();
  } else {
    if (!_processorLight) _processorLight = buildLightProcessor();
  }
  const proc = hasMath ? _processor! : _processorLight!;

  const hast = await proc.run(proc.parse(content));
  if (resolveImageUri) {
    visitHastImages(hast, resolveImageUri);
  }
  return toHtml(hast as Root);
}
