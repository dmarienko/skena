// - run: npx esbuild src/extension/knowledge/mcpHttpClient.ts --bundle --format=esm --platform=node --outfile=tests/.build/mcpHttpClient.mjs && node --test tests/knowledge-http.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import { McpHttpClient } from './.build/mcpHttpClient.mjs';

function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => handler(req, JSON.parse(b), res)); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/mcp` }));
  });
}

test('initialize once, then tools/call; bearer and session id travel; JSON and SSE bodies both work', async () => {
  const seen = [];
  const { srv, url } = await serve((req, msg, res) => {
    seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'], method: msg.method });
    if (msg.method === 'initialize') { res.setHeader('Mcp-Session-Id', 's1'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26' } })); return; }
    if (msg.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    res.setHeader('content-type', 'text/event-stream');
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '{"result":[1]}' }] } })}\n\n`);
  });
  const c = new McpHttpClient({ url, token: 'tok', timeoutMs: 2000 });
  const r = await c.callTool('search', { query: 'x' });
  assert.deepEqual(r, { result: [1] });
  assert.equal(seen[0].method, 'initialize'); assert.equal(seen[0].auth, 'Bearer tok');
  assert.equal(seen.at(-1).method, 'tools/call'); assert.equal(seen.at(-1).session, 's1');
  await c.callTool('search', { query: 'y' });
  assert.equal(seen.filter(s => s.method === 'initialize').length, 1);
  srv.close();
});

test('a server that does not answer in time rejects with a plain message', async () => {
  const { srv, url } = await serve(() => { /* - never respond */ });
  const c = new McpHttpClient({ url, timeoutMs: 100 });
  await assert.rejects(c.callTool('search', {}), /timed out/);
  srv.close();
});

test('an HTTP error status rejects with the status and the server\'s own error text', async () => {
  const { srv, url } = await serve((req, msg, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'nope' } }));
  });
  const c = new McpHttpClient({ url, timeoutMs: 1000 });
  await assert.rejects(c.callTool('search', {}), /401 .*nope/);
  srv.close();
});

test('a lost session (404 on tools/call) re-initializes once and retries the call', async () => {
  const seen = [];
  let initCount = 0;
  let callCount = 0;
  const { srv, url } = await serve((req, msg, res) => {
    seen.push({ session: req.headers['mcp-session-id'], method: msg.method });
    if (msg.method === 'initialize') {
      initCount++;
      res.setHeader('Mcp-Session-Id', initCount === 1 ? 's1' : 's2');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26' } }));
      return;
    }
    if (msg.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    callCount++;
    if (callCount === 1) { res.statusCode = 404; res.end('session not found'); return; }
    res.setHeader('content-type', 'text/event-stream');
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '{"result":[2]}' }] } })}\n\n`);
  });
  const c = new McpHttpClient({ url, timeoutMs: 2000 });
  const r = await c.callTool('search', { query: 'x' });
  assert.deepEqual(r, { result: [2] });
  assert.equal(seen.filter(s => s.method === 'initialize').length, 2);
  assert.equal(seen.at(-1).session, 's2');
  srv.close();
});

test('an event-stream reply is read up to the matching id, not to the end of the stream', async () => {
  const open = [];
  const { srv, url } = await serve((req, msg, res) => {
    if (msg.method === 'initialize') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })); return; }
    if (msg.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    res.setHeader('content-type', 'text/event-stream');
    // - a keep-alive, then the answer; the stream is never ended
    res.write(': ping\n\n');
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '{"result":[3]}' }] } })}\n\n`);
    open.push(res);
  });
  const c = new McpHttpClient({ url, timeoutMs: 5000 });
  const started = Date.now();
  const r = await c.callTool('search', {});
  const took = Date.now() - started;
  assert.deepEqual(r, { result: [3] });
  assert.ok(took < 2000, `answered in ${took} ms, well under the 5000 ms timeout`);
  for (const res of open) res.end();
  srv.close();
});

test('the caller\'s signal aborts a call in flight and rejects with cancelled', async () => {
  const { srv, url } = await serve(() => { /* - never respond */ });
  const c = new McpHttpClient({ url, timeoutMs: 5000 });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 50);
  const started = Date.now();
  await assert.rejects(c.callTool('search', {}, ctl.signal), /cancelled/);
  assert.ok(Date.now() - started < 2000, 'rejected on the abort, not on the timeout');
  srv.close();
});

test('an aborted call and a timed-out call leave no unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = r => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  // - a stream the server opens and never finishes: the read is still in flight when the call ends
  const open = [];
  const { srv, url } = await serve((req, msg, res) => {
    if (msg.method === 'initialize') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })); return; }
    if (msg.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    res.setHeader('content-type', 'text/event-stream');
    res.write(': ping\n\n');
    open.push(res);
  });

  const c1 = new McpHttpClient({ url, timeoutMs: 5000 });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(c1.callTool('search', {}, ctl.signal), /cancelled/);

  const c2 = new McpHttpClient({ url, timeoutMs: 100 });
  await assert.rejects(c2.callTool('search', {}), /timed out/);

  // - a rejection with no handler is reported on the next turns of the loop, not synchronously
  await new Promise(r => setTimeout(r, 50));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled.length, 0, `unhandled rejections: ${unhandled.map(String).join(', ')}`);
  for (const res of open) res.end();
  srv.close();
});

function serveGet(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => handler(req, res));
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/asset` }));
  });
}

test('getWithAuth sends the bearer token', async () => {
  let seen;
  const { srv, url } = await serveGet((req, res) => {
    seen = req.headers.authorization;
    res.setHeader('content-type', 'image/svg+xml');
    res.end('<svg/>');
  });
  const c = new McpHttpClient({ url, token: 'tok', timeoutMs: 2000 });
  await c.getWithAuth(url);
  assert.equal(seen, 'Bearer tok');
  srv.close();
});

test('getWithAuth on a non-2xx status rejects with "HTTP <status>"', async () => {
  const { srv, url } = await serveGet((req, res) => { res.statusCode = 404; res.end('not found'); });
  const c = new McpHttpClient({ url, timeoutMs: 2000 });
  await assert.rejects(c.getWithAuth(url), /^Error: HTTP 404/);
  srv.close();
});

test('getWithAuth strips "; charset=…" off the content-type', async () => {
  const { srv, url } = await serveGet((req, res) => {
    res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
    res.end('<svg/>');
  });
  const c = new McpHttpClient({ url, timeoutMs: 2000 });
  const { mime } = await c.getWithAuth(url);
  assert.equal(mime, 'image/svg+xml');
  srv.close();
});

test('getWithAuth with no content-type header falls back to application/octet-stream', async () => {
  const { srv, url } = await serveGet((req, res) => { res.end(Buffer.from([1, 2, 3])); });
  const c = new McpHttpClient({ url, timeoutMs: 2000 });
  const { mime } = await c.getWithAuth(url);
  assert.equal(mime, 'application/octet-stream');
  srv.close();
});

test('getWithAuth on a server that never answers rejects with the timeout message', async () => {
  const { srv, url } = await serveGet(() => { /* - never respond */ });
  const c = new McpHttpClient({ url, timeoutMs: 100 });
  await assert.rejects(c.getWithAuth(url), /timed out after 100 ms/);
  srv.close();
});

test('getWithAuth rejects with "cancelled" when the caller\'s signal aborts', async () => {
  const { srv, url } = await serveGet(() => { /* - never respond */ });
  const c = new McpHttpClient({ url, timeoutMs: 5000 });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 50);
  const started = Date.now();
  await assert.rejects(c.getWithAuth(url, ctl.signal), /cancelled/);
  assert.ok(Date.now() - started < 2000, 'rejected on the abort, not on the timeout');
  srv.close();
});
