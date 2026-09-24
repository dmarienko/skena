// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-comm.mjs && node --test tests/jupyter-comm.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseReply } from './.build/jupyter-comm.mjs';

test('comm_open carries model name and initial state', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_open' },
    content: { comm_id: 'c1', target_name: 'jupyter.widget', data: { state: { _model_name: 'FloatProgressModel', value: 0, max: 10 } } },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.id, 'c1');
  assert.equal(p.comm.sub, 'open');
  assert.equal(p.comm.modelName, 'FloatProgressModel');
  assert.equal(p.comm.state.max, 10);
});

test('comm_msg update carries the changed state', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_msg' },
    content: { comm_id: 'c1', data: { method: 'update', state: { value: 5 } } },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.sub, 'msg');
  assert.equal(p.comm.state.value, 5);
});

test('comm_close is recognised', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_close' }, content: { comm_id: 'c1' },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.sub, 'close');
});
