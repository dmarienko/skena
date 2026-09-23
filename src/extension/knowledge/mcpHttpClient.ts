import { buildRequest, hasResponse, parseJsonBody, parseSseBody, pickResponse, toolResultText } from '../../shared/knowledge/jsonrpc';
import type { RpcMessage } from '../../shared/knowledge/jsonrpc';
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

// - the call's own deadline and the caller's cancel as one signal; AbortSignal.any arrived in
//   Node 20 and the host may be older
function anySignal(deadline: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return deadline;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([deadline, external]);
  const ctl = new AbortController();
  if (deadline.aborted || external.aborted) ctl.abort();
  else for (const s of [deadline, external]) s.addEventListener('abort', () => ctl.abort(), { once: true });
  return ctl.signal;
}

// - an event-stream reply is a stream the server may keep open after the answer: read block by
//   block and stop at the frame this request waited for, rather than at the end of the stream
async function readSseUntil(res: Response, id: number): Promise<RpcMessage[]> {
  if (!res.body) return parseSseBody(await res.text());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const msgs: RpcMessage[] = [];
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      const blocks = buf.split(/\r?\n\r?\n/);
      // - what follows the last blank line is a block the server is still writing
      buf = done ? '' : blocks.pop() ?? '';
      for (const b of blocks) msgs.push(...parseSseBody(b));
      if (done || hasResponse(msgs, id)) return msgs;
    }
  } finally {
    // - cancelling a reader whose stream already failed rejects; the read path has reported that
    //   failure already, so drop it here rather than leave an unhandled rejection
    void reader.cancel().catch(() => {});
  }
}

// - streamable HTTP: every request is a POST; the reply is JSON or an SSE stream holding the reply
export class McpHttpClient implements ToolTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialized: Promise<void> | undefined;

  constructor(private readonly opts: McpHttpClientOptions) {}

  // - one deadline for the whole call: initialize, the initialized notice and tools/call all share
  //   it, so a cold first call cannot take three timeouts' worth of waiting. `signal` is the
  //   caller's own cancel; a call it aborts rejects with "cancelled", not with the timeout text
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 5000);
    const combined = anySignal(ctl.signal, signal);
    try {
      try {
        return await this.call(name, args, combined);
      } catch (e) {
        if (signal?.aborted) throw new Error('cancelled');
        if (this.sessionId && LOST_SESSION.test((e as Error).message)) {
          this.sessionId = undefined;
          this.initialized = undefined;
          return await this.call(name, args, combined);
        }
        throw e;
      }
    } finally { clearTimeout(timer); }
  }

  // - a plain GET on the server's HTTP side (an image, a file), with the same headers and the same
  //   deadline as a tool call; the body is read whole, so this is for small files
  async getWithAuth(url: string, signal?: AbortSignal): Promise<{ mime: string; bytes: Uint8Array }> {
    const ctl = new AbortController();
    const timeoutMs = this.opts.timeoutMs ?? 5000;
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}) },
        signal: anySignal(ctl.signal, signal),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
      const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
      return { mime, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (e) {
      if (signal?.aborted) throw new Error('cancelled');
      if ((e as Error).name === 'AbortError') throw new Error(`${url} timed out after ${timeoutMs} ms`);
      throw e;
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
      await this.post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, signal);
    })().catch(e => { this.initialized = undefined; throw e; });
    return this.initialized;
  }

  private async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const msgs = await this.post(buildRequest(id, method, params), id, signal);
    return pickResponse(msgs, id);
  }

  // - expect is the request id whose reply to read back, or null for a notification
  private async post(body: string, expect: number | null, signal: AbortSignal): Promise<RpcMessage[]> {
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
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.opts.url}${describeErrorBody(await res.text())}`);
      // - a notification has no reply to wait for; release the socket without reading the body,
      //   which a server is free to leave open
      if (expect === null) { void res.body?.cancel(); return []; }
      return (res.headers.get('content-type') ?? '').includes('text/event-stream')
        ? await readSseUntil(res, expect)
        : parseJsonBody(await res.text());
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`${this.opts.url} timed out after ${this.opts.timeoutMs ?? 5000} ms`);
      throw e;
    }
  }
}
