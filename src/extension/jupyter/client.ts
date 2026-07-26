import WebSocket from 'ws';
import { buildExecuteRequest, collectOutputs, buildCompleteRequest, parseCompleteReply, buildInspectRequest, parseInspectReply, type CollectedOutput, type CompleteResult, type InspectResult } from './protocol';
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

export interface KernelSpec {
  name:        string;   // - the id to POST when starting (e.g. "python3", "xmetals")
  displayName: string;   // - human label (e.g. "Python 3 (ipykernel)")
}

// - GET /api/kernelspecs — the kernel environments a NEW kernel can be started from
export async function listKernelSpecs(server: KernelServerConfig): Promise<KernelSpec[]> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernelspecs`, {
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`GET /api/kernelspecs ${res.status}`);
  const body = (await res.json()) as { kernelspecs?: Record<string, { name?: string; spec?: { display_name?: string } }> };
  return Object.entries(body.kernelspecs ?? {}).map(([name, v]) => ({
    name: v.name ?? name,
    displayName: v.spec?.display_name ?? name,
  }));
}

// - GET /api/sessions — maps a live kernel id to the notebook/path it is attached to
export async function listSessions(server: KernelServerConfig): Promise<Map<string, string>> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/sessions`, {
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`GET /api/sessions ${res.status}`);
  const arr = (await res.json()) as { path?: string; name?: string; kernel?: { id?: string } }[];
  const byKernel = new Map<string, string>();
  for (const s of arr) {
    if (s.kernel?.id) byKernel.set(s.kernel.id, s.name || s.path || '');
  }
  return byKernel;
}

// - POST /api/kernels/{id}/interrupt — stop a long-running cell without losing state
export async function interruptKernel(server: KernelServerConfig, kernelId: string): Promise<void> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels/${kernelId}/interrupt`, {
    method: 'POST',
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`POST /api/kernels/${kernelId}/interrupt ${res.status}`);
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

// - open a WS, request tab-completion at a cursor, resolve with the matches
export async function completeCode(
  server:   KernelServerConfig,
  kernelId: string,
  code:     string,
  cursorPos: number,
  ids:      { msgId: string; session: string; date: string },
): Promise<CompleteResult> {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `token ${server.token}` } });
  const empty: CompleteResult = { matches: [], cursorStart: cursorPos, cursorEnd: cursorPos };

  return new Promise<CompleteResult>(resolve => {
    let done = false;
    const finish = (r: CompleteResult) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* noop */ } resolve(r); };
    const timer = setTimeout(() => finish(empty), 4000);
    ws.on('open', () => ws.send(JSON.stringify(buildCompleteRequest(code, cursorPos, ids))));
    ws.on('message', raw => {
      try {
        const r = parseCompleteReply(JSON.parse(raw.toString()), ids.msgId);
        if (r) finish(r);
      } catch { /* - ignore non-JSON frames */ }
    });
    ws.on('error', () => finish(empty));
    ws.on('close', () => finish(empty));
  });
}

// - open a WS, request introspection at a cursor, resolve with the text/plain result
export async function inspectCode(
  server:   KernelServerConfig,
  kernelId: string,
  code:     string,
  cursorPos: number,
  ids:      { msgId: string; session: string; date: string },
): Promise<InspectResult> {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `token ${server.token}` } });
  const empty: InspectResult = { found: false, text: '' };

  return new Promise<InspectResult>(resolve => {
    let done = false;
    const finish = (r: InspectResult) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* noop */ } resolve(r); };
    const timer = setTimeout(() => finish(empty), 4000);
    ws.on('open', () => ws.send(JSON.stringify(buildInspectRequest(code, cursorPos, ids))));
    ws.on('message', raw => {
      try {
        const r = parseInspectReply(JSON.parse(raw.toString()), ids.msgId);
        if (r) finish(r);
      } catch { /* - ignore non-JSON frames */ }
    });
    ws.on('error', () => finish(empty));
    ws.on('close', () => finish(empty));
  });
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
