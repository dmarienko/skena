// - run: npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=tests/.build/jupyter-output.mjs && npx esbuild src/shared/plotlyParts.ts --bundle --format=esm --platform=node --outfile=tests/.build/plotlyParts.mjs && node --test tests/jupyter-output.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderOutput } from './.build/jupyter-output.mjs';
import { plotlyPartFigures } from './.build/plotlyParts.mjs';

test('console tqdm stream collapses to final bar', () => {
  const out = { streamText: '10%\r50%\r100%', rich: [], status: 'ok', done: true, widgets: {} };
  const r = renderOutput(out);
  assert.equal(r.format, 'html');
  assert.ok(r.content.includes('100%'));
  assert.ok(!r.content.includes('10%'), 'earlier frames must be gone');
});

test('widget-view mime renders the referenced model, not the json', () => {
  const out = {
    streamText: '',
    rich: [{ mime: 'application/vnd.jupyter.widget-view+json', data: JSON.stringify({ model_id: 'c1' }) }],
    status: 'ok', done: true,
    widgets: { c1: { modelName: 'FloatProgressModel', state: { value: 3, min: 0, max: 6 } } },
  };
  const r = renderOutput(out);
  assert.equal(r.format, 'html');
  assert.ok(r.content.includes('width:50.0%'), r.content);
  assert.ok(!r.content.includes('model_id'), 'raw json must not leak');
});

test('a table and two plotly figures in one run: both figures kept in order, after the table', () => {
  const f1 = JSON.stringify({ data: [{ type: 'scatter', y: [1, 2] }], layout: { title: { text: 'executions' } } });
  const f2 = JSON.stringify({ data: [{ type: 'bar', y: [3] }], layout: {} });
  const out = {
    streamText: '',
    rich: [
      { mime: 'text/html', data: '<table><tr><td>fill</td></tr></table>' },
      { mime: 'application/vnd.plotly.v1+json', data: f1 },
      { mime: 'application/vnd.plotly.v1+json', data: f2 },
    ],
    status: 'ok', done: true, widgets: {},
  };
  const r = renderOutput(out);
  assert.equal(r.format, 'html');
  assert.deepEqual(plotlyPartFigures(r.content), [f1, f2]);
  assert.ok(r.content.indexOf('<table>') < r.content.indexOf('skena-plotly-part'));
  assert.ok(!r.content.includes('one interactive figure per cell run'));
});

test('a lone plotly figure keeps its own format', () => {
  const f = JSON.stringify({ data: [], layout: {} });
  const r = renderOutput({ streamText: '', rich: [{ mime: 'application/vnd.plotly.v1+json', data: f }], status: 'ok', done: true, widgets: {} });
  assert.deepEqual(r, { format: 'plotly', content: f });
});
