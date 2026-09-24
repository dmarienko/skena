// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-widget-registry.mjs && node --test tests/jupyter-widget-registry.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collectOutputs } from './.build/jupyter-widget-registry.mjs';

const S = (type, content) => ({ parent_header: { msg_id: 'm1' }, header: { msg_type: type }, content });

test('comm_open then comm_msg builds and patches the model', () => {
  const seq = [
    S('comm_open', { comm_id: 'c1', data: { state: { _model_name: 'FloatProgressModel', value: 0, max: 10 } } }),
    S('comm_msg',  { comm_id: 'c1', data: { method: 'update', state: { value: 7 } } }),
    S('status',    { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.widgets.c1.modelName, 'FloatProgressModel');
  assert.equal(out.widgets.c1.state.value, 7);
  assert.equal(out.widgets.c1.state.max, 10);
});

test('comm frames are kept even without the execute parent (relaxed filter)', () => {
  const orphan = { parent_header: { msg_id: 'OTHER' }, header: { msg_type: 'comm_msg' }, content: { comm_id: 'c1', data: { method: 'update', state: { value: 3 } } } };
  const seq = [
    S('comm_open', { comm_id: 'c1', data: { state: { _model_name: 'IntProgressModel', value: 0, max: 5 } } }),
    orphan,
    S('status', { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.widgets.c1.state.value, 3);
});

test('widget-view mime is captured as rich output', () => {
  const seq = [
    S('display_data', { data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'c1' }, 'text/plain': 'FloatProgress(value=0.0)' } }),
    S('status', { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.rich[0].mime, 'application/vnd.jupyter.widget-view+json');
  assert.ok(out.rich[0].data.includes('c1'));
});
