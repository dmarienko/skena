/**
 * The stylesheets the HTML export puts into every page, written to dist/export-assets/ by the build:
 * the packaged extension ships dist/ but not node_modules or src. KaTeX's CSS with its woff2 fonts
 * as data urls (the woff and ttf copies left out), the codicon CSS with its font, skena's canvas and
 * markdown CSS with the export's own rules, and the IBM Plex fonts of the factors theme.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dataUrl = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;

export function katexCss() {
  const cssPath = require.resolve('katex/dist/katex.min.css');
  const dir = dirname(cssPath);
  return readFileSync(cssPath, 'utf8').replace(/src:([^;}]*)/g, (whole, list) => {
    const woff2 = /url\(([^)]+\.woff2)\)\s*format\(["']woff2["']\)/.exec(list);
    return woff2 ? `src:url(${dataUrl(join(dir, woff2[1]), 'font/woff2')}) format("woff2")` : whole;
  });
}

export function codiconCss() {
  const cssPath = require.resolve('@vscode/codicons/dist/codicon.css');
  return readFileSync(cssPath, 'utf8')
    .replace(/url\(["']?\.\/codicon\.ttf[^)"']*["']?\)/g, () => `url(${dataUrl(join(dirname(cssPath), 'codicon.ttf'), 'font/ttf')})`);
}

/** Writes katex.css, codicon.css, ibm-plex.css and skena.css into `outDir`; `root` is the repo. */
export function buildExportAssets(root, outDir) {
  const read = rel => readFileSync(join(root, rel), 'utf8');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'katex.css'), katexCss());
  writeFileSync(join(outDir, 'codicon.css'), codiconCss());
  writeFileSync(join(outDir, 'ibm-plex.css'), read('src/webview/styles/fonts-ibm-plex.css'));
  writeFileSync(join(outDir, 'skena.css'), [
    read('src/webview/styles/canvas.css'),
    read('src/webview/styles/markdown.css'),
    read('src/extension/export/export.css'),
  ].join('\n'));
}
