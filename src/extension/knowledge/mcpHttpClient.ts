import { buildRequest, parseJsonBody, parseSseBody, pickResponse, toolResultText } from '../../shared/knowledge/jsonrpc';
import type { ToolTransport } from '../../shared/knowledge/types';

export interface McpHttpClientOptions { url: string; token?: string; timeoutMs?: number; clientName?: string }

// - streamable HTTP: every request is a POST; the reply is JSON or an SSE stream holding the reply
export class McpHttpClient implements ToolTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialized: Promise<void> | undefined;

  constructor(private readonly opts: McpHttpClientOptions) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    const result = await this.request('tools/call', { name, arguments: args });
    return toolResultText(result);
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= (async () => {
      await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: this.opts.clientName ?? 'skena', version: '1' },
      });
      await this.post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), false);
    })().catch(e => { this.initialized = undefined; throw e; });
    return this.initialized;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msgs = await this.post(buildRequest(id, method, params), true);
    return pickResponse(msgs, id);
  }

  private async post(body: string, expectReply: boolean) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 5000);
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
        signal: ctl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.opts.url}`);
      if (!expectReply) return [];
      const text = await res.text();
      return (res.headers.get('content-type') ?? '').includes('text/event-stream') ? parseSseBody(text) : parseJsonBody(text);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`${this.opts.url} timed out after ${this.opts.timeoutMs ?? 5000} ms`);
      throw e;
    } finally { clearTimeout(timer); }
  }
}
