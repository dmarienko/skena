// - run: npx esbuild src/shared/knowledge/jsonrpc.ts --bundle --format=esm --outfile=tests/.build/jsonrpc.mjs && node --test tests/knowledge-jsonrpc.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildRequest, hasResponse, parseJsonBody, parseSseBody, pickResponse, toolResultText } from './.build/jsonrpc.mjs';

test('buildRequest frames a tools/call with an id', () => {
  const r = buildRequest(7, 'tools/call', { name: 'search', arguments: { query: 'x' } });
  assert.deepEqual(JSON.parse(r), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } });
});

test('parseJsonBody returns the one message', () => {
  assert.deepEqual(parseJsonBody('{"jsonrpc":"2.0","id":7,"result":{"ok":1}}'), [{ jsonrpc: '2.0', id: 7, result: { ok: 1 } }]);
});

test('parseSseBody returns every message event, ignoring comments and other events', () => {
  const body = ': keepalive\n\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\nevent: ping\ndata: {}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n';
  assert.deepEqual(parseSseBody(body).map(m => m.id), [1, 2]);
});

test('parseSseBody drops a valid JSON-RPC frame carried on a non-message event', () => {
  const body = 'event: ping\ndata: {"jsonrpc":"2.0","id":9,"result":{}}\n\n';
  assert.deepEqual(parseSseBody(body), []);
});

test('parseSseBody joins multi-line data', () => {
  const body = 'data: {"jsonrpc":"2.0",\ndata: "id":3,"result":{}}\n\n';
  assert.equal(parseSseBody(body)[0].id, 3);
});

test('pickResponse finds the message by id and surfaces a JSON-RPC error as an Error', () => {
  const msgs = [{ jsonrpc: '2.0', id: 1, result: { x: 1 } }, { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad vault' } }];
  assert.deepEqual(pickResponse(msgs, 1), { x: 1 });
  assert.throws(() => pickResponse(msgs, 2), /bad vault/);
  assert.throws(() => pickResponse(msgs, 3), /no response/);
});

test('pickResponse surfaces a whole-request error the server answered under its own id', () => {
  const serverError = [{ jsonrpc: '2.0', id: 'server-error', error: { code: -32600, message: 'Bad Request: Missing session ID' } }];
  assert.throws(() => pickResponse(serverError, 4), /Missing session ID/);
  const parseError = [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }];
  assert.throws(() => pickResponse(parseError, 4), /Parse error/);
});

test('hasResponse is true for this id and for a whole-request error, false for another id', () => {
  assert.equal(hasResponse([{ jsonrpc: '2.0', id: 1, result: {} }], 1), true);
  assert.equal(hasResponse([{ jsonrpc: '2.0', id: 1, result: {} }], 2), false);
  assert.equal(hasResponse([{ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'bad' } }], 1), false);
  assert.equal(hasResponse([{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }], 1), true);
  // - a notification the server pushes while the answer is still coming does not end the wait
  assert.equal(hasResponse([{ jsonrpc: '2.0', method: 'notifications/message', params: {} }], 1), false);
});

test('toolResultText joins the text parts of an MCP tool result and parses JSON when it is JSON', () => {
  const res = { content: [{ type: 'text', text: '{"result":[{"name":"crtx"}]}' }] };
  assert.deepEqual(toolResultText(res), { result: [{ name: 'crtx' }] });
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'plain' }, { type: 'text', text: ' more' }] }), 'plain more');
  assert.throws(() => toolResultText({ isError: true, content: [{ type: 'text', text: 'heading not found: a, b' }] }), /heading not found/);
});

test('toolResultText takes structuredContent, and one text item per hit as an array', () => {
  // - measured on crtx 1.28.1, tools/call search with top 2
  const hits = [{ vault: 'crtx', file: 'a.md' }, { vault: 'crtx', file: 'b.md' }];
  const live = {
    content: hits.map(h => ({ type: 'text', text: JSON.stringify(h) })),
    structuredContent: { result: hits },
    isError: false,
  };
  assert.deepEqual(toolResultText(live), { result: hits });
  assert.deepEqual(toolResultText({ content: live.content }), hits);
  assert.deepEqual(toolResultText({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'plain text' }] }), 'plain text');
});
