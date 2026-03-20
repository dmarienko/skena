/**
 * esbuild config for Skena VS Code extension.
 *
 * Two separate bundles:
 *   1. extension  — Node.js CJS, runs in VS Code extension host
 *   2. webview    — ESM browser bundle, runs in VS Code webview sandbox
 *
 * Usage:
 *   node esbuild.config.mjs          # single build
 *   node esbuild.config.mjs --watch  # watch mode
 */

import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const baseOptions = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  ...baseOptions,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  // - Node.js CJS bundle for the VS Code extension host
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: [
    // - VS Code API is provided by the host at runtime — never bundle it
    'vscode',
  ],
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  ...baseOptions,
  entryPoints: ['src/webview/index.tsx'],
  outfile: 'dist/webview.js',
  // - Browser bundle for the React webview
  platform: 'browser',
  format: 'iife',
  target: ['es2020', 'chrome108'],
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

if (watch) {
  const [extCtx, webCtx] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
