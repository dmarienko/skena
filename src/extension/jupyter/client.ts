import WebSocket from 'ws';
import { buildExecuteRequest, collectOutputs, type CollectedOutput } from './protocol';
import type { KernelServerConfig } from './config';

export interface LiveKernel {
  id:    string;
  name:  string;
  state: 'idle' | 'busy' | 'starting' | 'dead';
  connections?: number;
}

function restBase(hubUrl: string): string {
  return hubUrl.replace(/\/+$/, '');
}

function wsBase(hubUrl: string): string {
  return restBase(hubUrl).replace(/^http/, 'ws');
}

export async function listKernels(server: KernelServerConfig): Promise<LiveKernel[]> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels`, {
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`GET /api/kernels ${res.status}`);
  const arr = (await res.json()) as any[];
  return arr.map(k => ({ id: k.id, name: k.name, state: k.execution_state, connections: k.connections }));
}

export async function startKernel(server: KernelServerConfig, name = 'python3'): Promise<LiveKernel> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels`, {
    method: 'POST',
    headers: { Authorization: `token ${server.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`POST /api/kernels ${res.status}`);
  const k = (await res.json()) as any;
  return { id: k.id, name: k.name, state: k.execution_state ?? 'starting' };
}

// - POST /api/kernels/{id}/restart — same kernel id survives, namespace is wiped
export async function restartKernel(server: KernelServerConfig, kernelId: string): Promise<void> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels/${kernelId}/restart`, {
    method: 'POST',
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`POST /api/kernels/${kernelId}/restart ${res.status}`);
}

// - DELETE /api/kernels/{id} — shuts the kernel down (id becomes invalid)
export async function shutdownKernel(server: KernelServerConfig, kernelId: string): Promise<void> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels/${kernelId}`, {
    method: 'DELETE',
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE /api/kernels/${kernelId} ${res.status}`);
}

// - open a WS, run one cell, resolve with the collected output. onDelta fires as replies stream.
export async function executeCell(
  server:  KernelServerConfig,
  kernelId: string,
  code:    string,
  ids:     { msgId: string; session: string; date: string },
  onDelta?: (partial: CollectedOutput) => void,
): Promise<CollectedOutput> {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `token ${server.token}` } });
  const replies: unknown[] = [];

  return new Promise<CollectedOutput>((resolve, reject) => {
    const finish = (out: CollectedOutput) => { try { ws.close(); } catch { /* noop */ } resolve(out); };
    ws.on('open', () => ws.send(JSON.stringify(buildExecuteRequest(code, ids))));
    ws.on('message', raw => {
      try {
        replies.push(JSON.parse(raw.toString()));
        const out = collectOutputs(replies, ids.msgId);
        onDelta?.(out);
        if (out.done) finish(out);
      } catch { /* - ignore non-JSON frames */ }
    });
    ws.on('error', err => reject(err));
    ws.on('close', () => resolve(collectOutputs(replies, ids.msgId)));
  });
}
