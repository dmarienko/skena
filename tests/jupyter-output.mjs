// - run: npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=tests/.build/jupyter-output.mjs && node --test tests/jupyter-output.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderOutput } from './.build/jupyter-output.mjs';

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
