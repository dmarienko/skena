/**
 * The MCP tool's request to the relay of the running extension (POST /export), with its failures told
 * apart: nothing listening (no window), the connection dropped (the window closed or reloaded), and
 * no answer before `timeoutMs` (the export is still running). node:http rather than fetch: fetch
 * gives up waiting for a reply's headers after 300 s, and a large canvas can take longer.
 */

import * as http from 'http';

export type ExportOutcome =
  | { kind: 'answer'; status: number; body: string }
  | { kind: 'unreachable'; code: string }
  | { kind: 'closed'; message: string }
  | { kind: 'timeout' };

// - a connection that was never made: no relay at that port
const UNREACHABLE = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);

export function postExport(port: number, token: string, body: { canvasPath: string; outPath?: string }, timeoutMs: number): Promise<ExportOutcome> {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    let settled = false;
    const done = (o: ExportOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(o);
    };
    const req = http.request({
      host: '127.0.0.1', port, path: '/export', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-skena-token': token },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { text += c; });
      res.on('end', () => done({ kind: 'answer', status: res.statusCode ?? 0, body: text }));
      res.on('error', e => done({ kind: 'closed', message: e.message }));
    });
    const timer = setTimeout(() => { done({ kind: 'timeout' }); req.destroy(); }, timeoutMs);
    req.on('error', (e: NodeJS.ErrnoException) => {
      done(e.code && UNREACHABLE.has(e.code) ? { kind: 'unreachable', code: e.code } : { kind: 'closed', message: e.message });
    });
    req.end(data);
  });
}
