export interface RpcMessage { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function buildRequest(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
}

export function parseJsonBody(body: string): RpcMessage[] {
  const v = JSON.parse(body) as RpcMessage | RpcMessage[];
  return Array.isArray(v) ? v : [v];
}

// - SSE: events separated by a blank line; `data:` lines of one event are joined with '\n';
//   comment lines start with ':'; only events whose data parses as JSON-RPC are returned
export function parseSseBody(body: string): RpcMessage[] {
  const out: RpcMessage[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { const m = JSON.parse(data) as RpcMessage; if (m && m.jsonrpc === '2.0') out.push(m); } catch { /* - not JSON-RPC: a ping or a comment */ }
  }
  return out;
}

export function pickResponse(msgs: RpcMessage[], id: number): unknown {
  const m = msgs.find(x => x.id === id);
  if (!m) throw new Error(`no response for request ${id}`);
  if (m.error) throw new Error(m.error.message);
  return m.result;
}

// - MCP tool results carry `content: [{type:'text', text}]`; servers put JSON in the text
export function toolResultText(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  if (r.isError) throw new Error(text || 'tool error');
  try { return JSON.parse(text); } catch { return text; }
}
