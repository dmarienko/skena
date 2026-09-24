// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-protocol.mjs && node --test tests/jupyter-protocol.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildExecuteRequest, parseReply, collectOutputs } from './.build/jupyter-protocol.mjs';

const IDS = { msgId: 'm1', session: 's1', date: '2026-07-25T00:00:00Z' };

test('buildExecuteRequest sets v5.3 header and code content', () => {
  const r = buildExecuteRequest('print(1)', IDS);
  assert.equal(r.channel, 'shell');
  assert.equal(r.header.msg_type, 'execute_request');
  assert.equal(r.header.version, '5.3');
  assert.equal(r.header.msg_id, 'm1');
  assert.equal(r.header.session, 's1');
  assert.equal(r.content.code, 'print(1)');
  assert.equal(r.content.silent, false);
  assert.equal(r.content.allow_stdin, false);
  assert.deepEqual(r.parent_header, {});
});

test('parseReply extracts parent msg id and stream kind', () => {
  const p = parseReply({
    channel: 'iopub', parent_header: { msg_id: 'm1' },
    header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'hi' },
  });
  assert.equal(p.parentMsgId, 'm1');
  assert.equal(p.kind, 'stream');
  assert.equal(p.text, 'hi');
});

test('collectOutputs accumulates stream then rich image, ends on idle', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'busy' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'a' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'b' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'display_data' }, content: { data: { 'image/png': 'BASE64PNG' } } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.streamText, 'ab');
  assert.equal(out.done, true);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.rich, [{ mime: 'image/png', data: 'BASE64PNG' }]);
});

test('collectOutputs marks error status on error reply', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'error' }, content: { ename: 'ValueError', evalue: 'bad', traceback: ['x'] } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.status, 'error');
  assert.match(out.error, /ValueError: bad/);
});

test('collectOutputs ignores replies for other msg ids', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'other' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'ZZZ' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.streamText, '');
});
