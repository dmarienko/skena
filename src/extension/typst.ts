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
