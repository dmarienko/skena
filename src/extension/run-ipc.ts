import * as http from 'http';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import type { HostToWebview, AgentRunPersistResult, ExportReply } from '../shared/types';
import { removeEndpoint, writeEndpoint } from './ipcEndpoint';

// - a tiny 127.0.0.1 relay so the OUT-OF-PROCESS MCP server can stream a running cell's live output
// - back to the extension host, which forwards it to the right canvas webview (no canvas reload).
// - the MCP posts newline-free JSON frames to POST /delta with an x-skena-token header; the host
// - looks up the panel by canvasPath and posts the carried message straight to its webview.
interface RunFrame { canvasPath: string; message: HostToWebview }

type ResolvePanel = (canvasPath: string) => vscode.WebviewPanel | undefined;
// - request/response: apply an agent-run mutation to the host's authoritative canvas + write it
// - (single-writer). Returns handled=false when no panel is open, so the MCP falls back to a direct write.
type PersistHandler = (canvasPath: string, payload: unknown) => Promise<AgentRunPersistResult>;
// - request/response: write the canvas as one HTML page (the MCP tool canvas_export_html)
type ExportHandler = (canvasPath: string, outPath: string | undefined) => Promise<ExportReply>;

class RunIpc {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private resolvePanel: ResolvePanel = () => undefined;
  private persistHandler: PersistHandler | null = null;
  private exportHandler: ExportHandler | null = null;
  // - the workspace folders whose endpoint file this relay wrote, or will write once it listens
  private advertised: string[] = [];

  // - start once on activation. Binds an ephemeral 127.0.0.1 port; the token gates every request.
  start(resolvePanel: ResolvePanel, persistHandler?: PersistHandler): void {
    if (this.server) return;
    this.resolvePanel = resolvePanel;
    this.persistHandler = persistHandler ?? null;
    this.token = randomUUID();
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.headers['x-skena-token'] !== this.token) {
        res.statusCode = 403; res.end(); return;
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8_000_000) req.destroy(); });
      req.on('end', () => { void this.handle(req.url ?? '', body, res); });
    });
    this.server.on('error', () => { /* - relay is best-effort; agent runs still persist to disk */ });
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server?.address();
      if (addr && typeof addr === 'object') this.port = addr.port;
      this.writeEndpoints();
    });
  }

  setExportHandler(fn: ExportHandler): void {
    this.exportHandler = fn;
  }

  /**
   * Writes the endpoint file of each workspace folder (ipcEndpoint.ts), so an MCP server Claude Code
   * started from .mcp.json finds this relay; before the relay listens, once it does.
   */
  advertise(workspaceDirs: string[]): void {
    this.advertised = workspaceDirs;
    this.writeEndpoints();
  }

  private writeEndpoints(): void {
    const endpoint = this.endpointEnv();
    if (!endpoint) return;
    for (const dir of this.advertised) {
      try { writeEndpoint(dir, endpoint); } catch { /* - best-effort, like the relay itself */ }
    }
  }

  // - route a POSTed body by url. /delta is fire-and-forget (forward → panel, 204); /persist is
  // - request/response (apply mutation via the host, reply with AgentRunPersistResult). Best-effort:
  // - a parse/handler error still answers {handled:false} so the MCP falls back to a direct write.
  private async handle(url: string, body: string, res: http.ServerResponse): Promise<void> {
    if (url === '/delta') {
      try {
        const frame = JSON.parse(body) as RunFrame;
        this.resolvePanel(frame.canvasPath)?.webview.postMessage(frame.message);
      } catch { /* - ignore a malformed frame */ }
      res.statusCode = 204; res.end(); return;
    }
    if (url === '/persist') {
      let result: AgentRunPersistResult = { handled: false };
      try {
        const { canvasPath, payload } = JSON.parse(body) as { canvasPath: string; payload: unknown };
        if (this.persistHandler) result = await this.persistHandler(canvasPath, payload);
      } catch { /* - fall back to {handled:false} */ }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result)); return;
    }
    if (url === '/export') {
      let reply: ExportReply = { ok: false, error: 'the extension has no export handler' };
      try {
        const { canvasPath, outPath } = JSON.parse(body) as { canvasPath: string; outPath?: string };
        if (this.exportHandler) reply = await this.exportHandler(canvasPath, outPath);
      } catch (e) {
        reply = { ok: false, error: (e as Error).message };
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply)); return;
    }
    res.statusCode = 403; res.end();
  }

  // - "port:token" for the MCP env, or null if the socket isn't listening yet (MCP then skips streaming)
  endpointEnv(): string | null {
    return this.port ? `${this.port}:${this.token}` : null;
  }

  dispose(): void {
    const endpoint = this.endpointEnv();
    if (endpoint) for (const dir of this.advertised) removeEndpoint(dir, endpoint);
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null; this.port = 0;
  }
}

export const runIpc = new RunIpc();
