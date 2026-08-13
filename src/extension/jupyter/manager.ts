import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveKernelConfig, type KernelServerConfig } from './config';
import { listKernels, startKernel, executeCell, completeCode, inspectCode, restartKernel, shutdownKernel, interruptKernel, type LiveKernel } from './client';
import type { CollectedOutput, CompleteResult, InspectResult } from './protocol';
import type { KernelStatusEntry } from '../../shared/types';

// - reads skena.jupyter.kernels, falling back to ~/.aix/xlmcp/.env
export function loadKernelServers(): KernelServerConfig[] {
  const setting = vscode.workspace.getConfiguration('skena').get<KernelServerConfig[]>('jupyter.kernels');
  let envText: string | null = null;
  try { envText = fs.readFileSync(path.join(os.homedir(), '.aix', 'xlmcp', '.env'), 'utf8'); } catch { /* - no env */ }
  return resolveKernelConfig(setting, envText);
}

export class KernelManager {
  private servers: KernelServerConfig[] = loadKernelServers();
  private timer:   ReturnType<typeof setInterval> | null = null;
  // - kernel ids currently running a cell, so the LED blinks the right kernel
  private running = new Set<string>();

  constructor(private readonly push: (kernels: KernelStatusEntry[]) => void) {}

  reloadConfig(): void { this.servers = loadKernelServers(); }

  serverByName(name: string): KernelServerConfig | undefined {
    return this.servers.find(s => s.name === name);
  }

  allServers(): KernelServerConfig[] { return this.servers; }

  startPolling(): void {
    if (this.timer) return;
    const tick = () => void this.poll();
    tick();
    this.timer = setInterval(tick, 2000);
  }

  stopPolling(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async poll(): Promise<void> {
    const entries: KernelStatusEntry[] = [];
    for (const s of this.servers) {
      try {
        const kernels = await listKernels(s);
        for (const k of kernels) entries.push({ server: s.name, kernelId: k.id, state: this.ledFor(k), connections: k.connections });
      } catch { /* - server unreachable: report nothing for it (nodes go grey) */ }
    }
    this.push(entries);
  }

  private ledFor(k: LiveKernel): KernelStatusEntry['state'] {
    if (k.state === 'dead') return 'dead';
    if (this.running.has(k.id) || k.state === 'busy') return 'busy';
    return 'idle';
  }

  async ensureKernel(server: KernelServerConfig, kernelId?: string, spec?: string): Promise<string> {
    if (kernelId) return kernelId;
    const k = await startKernel(server, spec);   // - spec undefined → startKernel defaults to 'python3'
    return k.id;
  }

  async restart(server: KernelServerConfig, kernelId: string): Promise<void> {
    await restartKernel(server, kernelId);
    void this.poll();
  }

  async shutdown(server: KernelServerConfig, kernelId: string): Promise<void> {
    await shutdownKernel(server, kernelId);
    this.running.delete(kernelId);
    void this.poll();
  }

  async interrupt(server: KernelServerConfig, kernelId: string): Promise<void> {
    await interruptKernel(server, kernelId);
  }

  async complete(
    server: KernelServerConfig,
    kernelId: string,
    code: string,
    cursorPos: number,
    ids: { msgId: string; session: string; date: string },
  ): Promise<CompleteResult> {
    return completeCode(server, kernelId, code, cursorPos, ids);
  }

  async inspect(
    server: KernelServerConfig,
    kernelId: string,
    code: string,
    cursorPos: number,
    ids: { msgId: string; session: string; date: string },
  ): Promise<InspectResult> {
    return inspectCode(server, kernelId, code, cursorPos, ids);
  }

  async run(
    server: KernelServerConfig,
    kernelId: string,
    code: string,
    ids: { msgId: string; session: string; date: string },
    onDelta?: (o: CollectedOutput) => void,
  ): Promise<CollectedOutput> {
    this.running.add(kernelId);
    void this.poll();
    try {
      return await executeCell(server, kernelId, code, ids, onDelta);
    } finally {
      this.running.delete(kernelId);
      void this.poll();
    }
  }
}
