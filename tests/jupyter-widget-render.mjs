// - run: npx esbuild src/extension/jupyter/widgets.ts --bundle --format=esm --outfile=tests/.build/jupyter-widget-render.mjs && node --test tests/jupyter-widget-render.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderWidget } from './.build/jupyter-widget-render.mjs';

test('FloatProgress renders a fill at the right percentage', () => {
  const widgets = { c1: { modelName: 'FloatProgressModel', state: { value: 5, min: 0, max: 10 } } };
  const html = renderWidget('c1', widgets);
  assert.ok(html.includes('width:50.0%'), html);
  assert.ok(html.includes('skena-w-progress'));
});

test('HTML label renders its value', () => {
  const widgets = { c1: { modelName: 'HTMLModel', state: { value: '5/10 [00:03<00:03]' } } };
  assert.ok(renderWidget('c1', widgets).includes('5/10 [00:03<00:03]'));
});

test('HBox resolves IPY_MODEL_ children in order', () => {
  const widgets = {
    box:  { modelName: 'HBoxModel', state: { children: ['IPY_MODEL_bar', 'IPY_MODEL_lbl'] } },
    bar:  { modelName: 'IntProgressModel', state: { value: 2, min: 0, max: 4 } },
    lbl:  { modelName: 'HTMLModel', state: { value: 'half' } },
  };
  const html = renderWidget('box', widgets);
  assert.ok(html.includes('width:50.0%'));
  assert.ok(html.includes('half'));
  assert.ok(html.indexOf('width:50.0%') < html.indexOf('half'), 'children in order');
});

test('unknown model → placeholder, never throws', () => {
  const widgets = { c1: { modelName: 'SliderModel', state: {} } };
  assert.ok(renderWidget('c1', widgets).includes('[unsupported widget: SliderModel]'));
});

test('missing model id → empty string', () => {
  assert.equal(renderWidget('nope', {}), '');
});
