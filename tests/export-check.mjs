// - run: npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && SKENA_EXPORT_HTML=<page.html> SKENA_EXPORT_CANVAS=<file.canvas> node --test tests/export-check.mjs
// - checks one exported page against the canvas it came from; every test is skipped when the two variables are not set
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkOffline } from './.build/offlineCheck.mjs';

const HTML = process.env.SKENA_EXPORT_HTML;
const CANVAS = process.env.SKENA_EXPORT_CANVAS;
const skip = !HTML || !CANVAS ? 'set SKENA_EXPORT_HTML and SKENA_EXPORT_CANVAS' : false;
const html = skip ? '' : readFileSync(HTML, 'utf8');
const canvas = skip ? { nodes: [], edges: [] } : JSON.parse(readFileSync(CANVAS, 'utf8'));
const nodes = canvas.nodes.filter(n => n.type !== 'group');
const ids = new Set(nodes.map(n => n.id));

test('1. the page loads nothing from the network', { skip }, () => {
  assert.deepEqual(checkOffline(html, []).remote, []);
});

test('2. every node but the groups is on the page, with its label', { skip }, () => {
  assert.deepEqual(checkOffline(html, [...ids]).missingNodeIds, []);
  const unlabelled = nodes.filter(n => n.nodeLabel && !html.includes(`data-label="${n.nodeLabel}"`)).map(n => n.nodeLabel);
  assert.deepEqual(unlabelled, []);
});

test('3. every edge between two shown nodes is drawn', { skip }, () => {
  const drawn = canvas.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  assert.equal((html.match(/<path data-edge-id="/g) ?? []).length, drawn.length);
});

test('4. every section has a frame', { skip }, () => {
  for (const s of canvas.metadata?.sections ?? []) assert.ok(html.includes(`data-section-id="${s.id}"`), s.id);
});

test('5. plotly.js is in the page once when a figure is, and every figure has its JSON', { skip }, () => {
  const figures = (html.match(/data-plotly="/g) ?? []).length;
  const json = (html.match(/<script type="application\/json" id="skena-fig-/g) ?? []).length;
  assert.equal(json, figures);
  assert.equal((html.match(/<script>/g) ?? []).length, figures ? 2 : 0);
});
