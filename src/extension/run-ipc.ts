import * as http from 'http';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import type { HostToWebview } from '../shared/types';

// - a tiny 127.0.0.1 relay so the OUT-OF-PROCESS MCP server can stream a running cell's live output
// - back to the extension host, which forwards it to the right canvas webview (no canvas reload).
// - the MCP posts newline-free JSON frames to POST /delta with an x-skena-token header; the host
// - looks up the panel by canvasPath and posts the carried message straight to its webview.
interface RunFrame { canvasPath: string; message: HostToWebview }

type ResolvePanel = (canvasPath: string) => vscode.WebviewPanel | undefined;

class RunIpc {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private resolvePanel: ResolvePanel = () => undefined;

  // - start once on activation. Binds an ephemeral 127.0.0.1 port; the token gates every request.
  start(resolvePanel: ResolvePanel): void {
    if (this.server) return;
    this.resolvePanel = resolvePanel;
    this.token = randomUUID();
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/delta' || req.headers['x-skena-token'] !== this.token) {
        res.statusCode = 403; res.end(); return;
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8_000_000) req.destroy(); });
      req.on('end', () => {
        try {
          const frame = JSON.parse(body) as RunFrame;
          this.resolvePanel(frame.canvasPath)?.webview.postMessage(frame.message);
        } catch { /* - ignore a malformed frame */ }
        res.statusCode = 204; res.end();
      });
    });
    this.server.on('error', () => { /* - relay is best-effort; agent runs still persist to disk */ });
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server?.address();
      if (addr && typeof addr === 'object') this.port = addr.port;
    });
  }

  // - "port:token" for the MCP env, or null if the socket isn't listening yet (MCP then skips streaming)
  endpointEnv(): string | null {
    return this.port ? `${this.port}:${this.token}` : null;
  }

  dispose(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null; this.port = 0;
  }
}

export const runIpc = new RunIpc();
