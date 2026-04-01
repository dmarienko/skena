/**
 * esbuild config for Skena VS Code extension.
 *
 * Three separate bundles:
 *   1. extension   — Node.js CJS, runs in VS Code extension host
 *   2. webview     — ESM browser bundle, runs in VS Code webview sandbox
 *   3. mcp-server  — standalone Node.js CJS script, deployed to .vscode/skena-mcp.js
 *
 * Usage:
 *   node esbuild.config.mjs          # single build
 *   node esbuild.config.mjs --watch  # watch mode
 */

import * as esbuild from 'esbuild';

const watch      = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const baseOptions = {
  bundle:    true,
  minify:    production,
  sourcemap: !production,
  logLevel:  'info',
};

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  ...baseOptions,
  entryPoints: ['src/extension/extension.ts'],
  outfile:     'dist/extension.js',
  // - Node.js CJS bundle for the VS Code extension host
  platform: 'node',
  format:   'cjs',
  target:   'node20',
  external: [
    // - VS Code API is provided by the host at runtime — never bundle it
    'vscode',
  ],
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  ...baseOptions,
  entryPoints: ['src/webview/index.tsx'],
  outfile:     'dist/webview.js',
  // - Browser bundle for the React webview
  platform: 'browser',
  format:   'iife',
  target:   ['es2020', 'chrome108'],
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  loader: {
    // - inline fonts as data URIs: Monaco codicon (.ttf) + KaTeX math fonts (.woff2/.woff)
    '.ttf':   'dataurl',
    '.woff2': 'dataurl',
    '.woff':  'dataurl',
  },
  alias: {
    // - monaco-vim imports without the .js extension; alias to the real path
    'monaco-editor/esm/vs/editor/editor.api': 'monaco-editor/esm/vs/editor/editor.api.js',
  },
};

/** @type {esbuild.BuildOptions} */
const mcpServerConfig = {
  ...baseOptions,
  entryPoints: ['src/extension/mcp/server.ts'],
  outfile:     'dist/mcp-server.js',
  // - standalone Node.js CJS script — no VS Code, no external deps
  platform: 'node',
  format:   'cjs',
  target:   'node20',
  external: [],  // - bundle everything; only Node built-ins are external
  banner:   { js: '#!/usr/bin/env node' },
};

if (watch) {
  const [extCtx, webCtx, mcpCtx] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
    esbuild.context(mcpServerConfig),
  ]);
  await Promise.all([extCtx.watch(), webCtx.watch(), mcpCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(mcpServerConfig),
  ]);
}
