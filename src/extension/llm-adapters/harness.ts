/**
 * HarnessAdapter — ILLMClient implementation that drives the Claude Code CLI
 * (the "harness") as a subprocess instead of @anthropic-ai/sdk.
 *
 * Auth: the user's existing `claude` /login credentials — NO API key.
 * Tools: the CLI runs them itself via the deployed skena MCP server
 *   (.vscode/skena-mcp.js), so the `tools` arg and onToolUse callback are unused.
 *   Canvas mutations land on disk → the editor's canvasWatcher reloads the webview.
 *
 * Verified by the 2026-06-29 spike: keyless auth + streaming work from the
 * extension host. See knowledge/driving-claude-cli-from-vscode-extension-host.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { ILLMClient, LLMMessage, LLMTool, LLMCallbacks, LLMContext } from '../llm-client';

const FALLBACK_BIN = path.join(os.homedir(), '.local', 'bin', 'claude');

export class HarnessAdapter implements ILLMClient {
  private _child: ChildProcess | null = null;
  private _aborted = false;
  private _out: vscode.OutputChannel | null = null;

  private log(msg: string): void {
    if (!this._out) this._out = vscode.window.createOutputChannel('Skena AI (harness)');
    this._out.appendLine(msg);
  }

  invalidate(): void { /* - no cached client; settings read per call */ }

  abort(): void {
    this._aborted = true;
    this._child?.kill();
  }

  async chat(
    systemPrompt: string,
    history:      LLMMessage[],
    _tools:       LLMTool[],          // - unused: the CLI owns its tool loop
    callbacks:    LLMCallbacks,
    context?:     LLMContext,
  ): Promise<void> {
    this._aborted = false;

    const canvasPath   = context?.canvasPath;
    const workspaceDir = context?.workspaceDir;
    if (!canvasPath || !workspaceDir) {
      callbacks.onError('Harness provider needs a workspace-resident canvas (canvasPath/workspaceDir missing).');
      return;
    }

    // - the skena MCP server is deployed here by activate(); it exposes canvas_* tools
    const mcpJs = path.join(workspaceDir, '.vscode', 'skena-mcp.js');
    if (!fs.existsSync(mcpJs)) {
      callbacks.onError(`skena MCP server not found at ${mcpJs}. Reopen the workspace to redeploy it.`);
      return;
    }

    // - write a one-server MCP config; --strict-mcp-config then loads ONLY this
    const mcpConfigPath = path.join(os.tmpdir(), `skena-mcp-${hashPath(workspaceDir)}.json`);
    try {
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: { skena: { type: 'stdio', command: 'node', args: [mcpJs] } },
      }));
    } catch (e) {
      callbacks.onError(`Failed to write MCP config: ${(e as Error).message}`);
      return;
    }

    const cfg      = vscode.workspace.getConfiguration('skena.ai');
    const bin      = cfg.get<string>('harnessPath')?.trim() || 'claude';
    const model    = cfg.get<string>('model') ?? 'claude-sonnet-4-5';
    const permMode = cfg.get<string>('harnessPermissionMode') ?? 'bypassPermissions';
    const maxTurns = cfg.get<number>('harnessMaxTurns') ?? 16;

    const system = `${systemPrompt}\n\n${harnessDirective(canvasPath)}`;

    // - resume the prior CC session when enabled and we have an id; otherwise
    // - start fresh and seed the new session by folding history into the prompt
    const launch = (resumeId: string | null): void => {
      const prompt = resumeId
        ? (history[history.length - 1]?.content ?? '')   // - session holds history; send latest only
        : formatPrompt(history);                          // - fresh: fold history into the prompt

      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',                              // - required with stream-json + --print
        '--model', model,
        '--permission-mode', permMode,
        '--max-turns', String(maxTurns),
        '--system-prompt', system,
        '--exclude-dynamic-system-prompt-sections', // - drop CC's coding-assistant env/git sections
        '--mcp-config', mcpConfigPath,            // - ensure skena server loads; user's other MCP servers also load (no --strict)
      ];
      if (resumeId) args.push('--resume', resumeId);

      this.spawnAndStream(bin, args, workspaceDir, callbacks, /*allowFallback*/ true,
        // - if a --resume attempt fails, retry once fresh (stale/expired session id)
        resumeId ? () => { this.log(`resume of ${resumeId} failed — retrying fresh`); launch(null); } : null);
    };

    const resumeId = context?.restoreSession && context?.sessionId ? context.sessionId : null;
    launch(resumeId);
  }

  private spawnAndStream(
    bin:           string,
    args:          string[],
    cwd:           string,
    callbacks:     LLMCallbacks,
    allowFallback: boolean,
    onResumeFail:  (() => void) | null = null,
  ): void {
    // - strip ELECTRON_RUN_AS_NODE so the spawned node-based CLI behaves normally
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    this.log(`spawn: ${bin} (cwd=${cwd}, model arg present, ${args.length} args)`);
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this._child = child;

    let buf = '';
    let anyText = false;
    let lastResultText = '';
    let isError = false;
    let stderr = '';
    let sessionId = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(line); } catch { continue; }

        switch (ev['type']) {
          case 'system':
            if (ev['subtype'] === 'init') {
              if (typeof ev['session_id'] === 'string') sessionId = ev['session_id'];
              this.log(`init: apiKeySource=${ev['apiKeySource']} model=${ev['model']} session=${sessionId}`);
            }
            break;
          case 'assistant': {
            // - emit each assistant message's text (v1: per-message, not per-token)
            const msg  = ev['message'] as { content?: Array<{ type: string; text?: string }> } | undefined;
            const text = msg?.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? '';
            if (text) { callbacks.onText(text); anyText = true; }
            break;
          }
          case 'result':
            isError = ev['is_error'] === true;
            lastResultText = typeof ev['result'] === 'string' ? (ev['result'] as string) : '';
            if (typeof ev['session_id'] === 'string') sessionId = ev['session_id'];
            this.log(`result: is_error=${isError} cost_usd=${ev['total_cost_usd']} session=${sessionId}`);
            break;
        }
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' && allowFallback && bin !== FALLBACK_BIN) {
        // - PATH didn't resolve `claude`; retry the known absolute path once
        this.log(`'${bin}' not found on PATH — retrying ${FALLBACK_BIN}`);
        this.spawnAndStream(FALLBACK_BIN, args, cwd, callbacks, /*allowFallback*/ false);
        return;
      }
      callbacks.onError(`Failed to launch '${bin}': ${err.message}`);
    });

    child.on('close', (code) => {
      this._child = null;
      if (this._aborted) { callbacks.onDone(); return; }
      if (isError || code !== 0) {
        // - a failed --resume (before any output) → retry fresh instead of erroring
        if (onResumeFail && !anyText) { onResumeFail(); return; }
        callbacks.onError(stderr.trim() || `claude exited with code ${code}`);
        return;
      }
      // - persist session id for next-time --resume
      if (sessionId) callbacks.onSessionId?.(sessionId);
      // - tool-only turn with no streamed assistant text → surface final result
      if (!anyText && lastResultText) callbacks.onText(lastResultText);
      callbacks.onDone();
    });
  }
}

/** - fold conversation history into a single prompt (CLI -p is single-shot) */
function formatPrompt(history: LLMMessage[]): string {
  if (history.length === 0) return '';
  const current = history[history.length - 1].content;
  const prior   = history.slice(0, -1);
  if (prior.length === 0) return current;
  const transcript = prior
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return `Earlier conversation:\n${transcript}\n\nCurrent request:\n${current}`;
}

/** - authoritative tool directive; supersedes buildSystemPrompt's add_note text */
function harnessDirective(canvasPath: string): string {
  return [
    '## Canvas tools (authoritative — overrides any earlier tool instructions)',
    'You operate this canvas through the `skena` MCP tools, NOT `add_note`/`read_node`.',
    `The current canvas file is at: ${canvasPath}`,
    'You MUST pass canvasPath="' + canvasPath + '" as an argument to EVERY skena canvas tool.',
    '',
    '- canvas_add_node + canvas_add_edge — capture findings as notes, connected to the focused node',
    '- canvas_read / canvas_list / canvas_search / canvas_edges / canvas_follow — explore the canvas',
    '- canvas_update_node / canvas_remove_node — edit or remove existing nodes',
    '',
    'File nodes are shown as a filesystem path, not inlined — open them with your Read tool when you need their content (this handles notebooks/large files cleanly).',
    '',
    'When you reach an insight or conclusion worth keeping, add it as a concise note connected to the currently focused node shown above.',
  ].join('\n');
}

/** - short stable token from a path, for temp-file naming */
function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h * 31 + p.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
