export interface RpcMessage { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function buildRequest(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
}

export function parseJsonBody(body: string): RpcMessage[] {
  const v = JSON.parse(body) as RpcMessage | RpcMessage[];
  return Array.isArray(v) ? v : [v];
}

// - SSE: events separated by a blank line; `data:` lines of one event are joined with '\n';
//   comment lines start with ':'; a named event other than 'message' is skipped whole; only
//   events whose data parses as JSON-RPC are returned
export function parseSseBody(body: string): RpcMessage[] {
  const out: RpcMessage[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
    if (event && event !== 'message') continue;
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { const m = JSON.parse(data) as RpcMessage; if (m && m.jsonrpc === '2.0') out.push(m); } catch { /* - not JSON-RPC: a ping or a comment */ }
  }
  return out;
}

// - which frames end the wait for this id's reply: its own, or one of the whole-request errors
//   pickResponse reads below
export function hasResponse(msgs: RpcMessage[], id: number): boolean {
  return msgs.some(m => m.id === id || (m.error && typeof m.id !== 'number'));
}

export function pickResponse(msgs: RpcMessage[], id: number): unknown {
  const m = msgs.find(x => x.id === id);
  if (m) {
    if (m.error) throw new Error(m.error.message);
    return m.result;
  }
  // - a server that rejects the whole request answers under its own id ('server-error', null, ...)
  //   rather than this one's; a lone error like that is why this id got no reply
  const serverErrors = msgs.filter(x => x.error && typeof x.id !== 'number');
  if (serverErrors.length === 1) throw new Error(serverErrors[0].error!.message);
  throw new Error(`no response for request ${id}`);
}

// - MCP tool results carry `content: [{type:'text', text}]`; servers put JSON in the text. The crtx
//   server sends one text item per hit and the whole answer again as `structuredContent`, so
//   joining the items would give "{…}{…}", which parses as nothing.
export function toolResultText(result: unknown): unknown {
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  const parts = (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '');
  if (r.isError) throw new Error(parts.join('') || 'tool error');
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  if (parts.length > 1) {
    // - JSON.parse never returns undefined, so it marks a part that is not JSON
    const each = parts.map(p => { try { return JSON.parse(p) as unknown; } catch { return undefined; } });
    if (each.every(v => v !== undefined)) return each;
  }
  const text = parts.join('');
  try { return JSON.parse(text); } catch { return text; }
}
