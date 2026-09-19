import { buildRequest, parseJsonBody, parseSseBody, pickResponse, toolResultText } from '../../shared/knowledge/jsonrpc';
import type { ToolTransport } from '../../shared/knowledge/types';

export interface McpHttpClientOptions { url: string; token?: string; timeoutMs?: number; clientName?: string }

// - a lost session: the server 404s the request, or answers 200 with a JSON-RPC error naming it
const LOST_SESSION = /HTTP 404|Missing session ID/;

// - an HTTP error body: its JSON-RPC error message if it has one, else a snippet of the raw text
function describeErrorBody(body: string): string {
  if (!body) return '';
  try {
    const err = parseJsonBody(body).find(m => m.error)?.error;
    return err ? `: ${err.message}` : '';
  } catch {
    return `: ${body.slice(0, 300)}`;
  }
}

// - streamable HTTP: every request is a POST; the reply is JSON or an SSE stream holding the reply
export class McpHttpClient implements ToolTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialized: Promise<void> | undefined;

  constructor(private readonly opts: McpHttpClientOptions) {}

  // - one deadline for the whole call: initialize, the initialized notice and tools/call all share
  //   it, so a cold first call cannot take three timeouts' worth of waiting
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 5000);
    try {
      try {
        return await this.call(name, args, ctl.signal);
      } catch (e) {
        if (this.sessionId && LOST_SESSION.test((e as Error).message)) {
          this.sessionId = undefined;
          this.initialized = undefined;
          return await this.call(name, args, ctl.signal);
        }
        throw e;
      }
    } finally { clearTimeout(timer); }
  }

  private async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    await this.ensureInitialized(signal);
    const result = await this.request('tools/call', { name, arguments: args }, signal);
    return toolResultText(result);
  }

  private ensureInitialized(signal: AbortSignal): Promise<void> {
    this.initialized ??= (async () => {
      await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: this.opts.clientName ?? 'skena', version: '1' },
      }, signal);
      await this.post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), false, signal);
    })().catch(e => { this.initialized = undefined; throw e; });
    return this.initialized;
  }

  private async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const msgs = await this.post(buildRequest(id, method, params), true, signal);
    return pickResponse(msgs, id);
  }

  private async post(body: string, expectReply: boolean, signal: AbortSignal) {
    try {
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body,
        signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.opts.url}${describeErrorBody(text)}`);
      if (!expectReply) return [];
      return (res.headers.get('content-type') ?? '').includes('text/event-stream') ? parseSseBody(text) : parseJsonBody(text);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`${this.opts.url} timed out after ${this.opts.timeoutMs ?? 5000} ms`);
      throw e;
    }
  }
}
