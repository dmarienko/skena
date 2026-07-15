// - host-side Typst compiler: compile a math snippet to a standalone inline SVG.
// - The compiler is a platform-specific native .node binary. Load it LAZILY via require()
// - in a try/catch: a top-level import runs at activation (markdown-html.ts imports this)
// - and would crash the WHOLE extension on any platform whose binary isn't shipped. On
// - load failure Typst degrades to a small notice; everything else keeps working.
import type { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';   // - type only, erased at build

let _compiler: NodeCompiler | null = null;
let _loadFailed = false;

function compiler(): NodeCompiler | null {
  if (_compiler) return _compiler;
  if (_loadFailed) return null;
  try {
    // - externalized from the esbuild bundle → resolved from node_modules at runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@myriaddreamin/typst-ts-node-compiler') as typeof import('@myriaddreamin/typst-ts-node-compiler');
    _compiler = mod.NodeCompiler.create();
    return _compiler;
  } catch {
    _loadFailed = true;   // - missing/incompatible binary → give up quietly, don't retry
    return null;
  }
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
  const c = compiler();
  if (!c) return `<span class="typst-error">Typst not available on this platform</span>`;
  // - auto-sized transparent page; wrap the snippet in Typst math mode
  const doc =
    '#set page(width: auto, height: auto, margin: 2pt, fill: none)\n' +
    (block ? `$ ${src} $` : `$${src}$`);
  try {
    const svg = c.svg({ mainFileContent: doc });
    if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) {
      return `<span class="typst-error">Typst: no output</span>`;
    }
    // - tag so the webview can style it (inline-block, vertical-align). The compiler's
    // - <svg> already has class="typst-doc" — merge into it rather than add a 2nd class
    // - attr (duplicate attrs: browser keeps the first, silently drops the rest).
    const cls = `typst-math ${block ? 'typst-block' : 'typst-inline'}`;
    let out = svg.includes('class="')
      ? svg.replace('class="', `class="${cls} `)
      : svg.replace('<svg', `<svg class="${cls}"`);
    // - Size in em so math scales with the surrounding font AND grows with content
    // - (display fractions get their true height). The SVG's data-width/height are in
    // - Typst units where a single text line ≈ 12; EM_UNITS tunes the on-screen size
    // - (÷10 → a single line ≈ 1.2em, a touch larger than KaTeX for legibility).
    const EM_UNITS = 9;
    const wm = svg.match(/data-width="([\d.]+)"/);
    const hm = svg.match(/data-height="([\d.]+)"/);
    if (wm && hm) {
      const wem = (+wm[1] / EM_UNITS).toFixed(3);
      const hem = (+hm[1] / EM_UNITS).toFixed(3);
      // - block: fixed width + auto height so max-width:100% in a narrow container (chat)
      // - scales proportionally instead of squishing; inline: both fixed (small, no wrap).
      const dims = block ? `width:${wem}em;height:auto;` : `width:${wem}em;height:${hem}em;`;
      out = out.includes('style="')
        ? out.replace('style="', `style="${dims}`)
        : out.replace('<svg', `<svg style="${dims}"`);
    }
    return out;
  } catch (e) {
    return `<span class="typst-error">Typst error: ${esc(String((e as Error)?.message ?? e)).slice(0, 120)}</span>`;
  }
}
