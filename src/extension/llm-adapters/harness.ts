/**
 * HarnessAdapter — drives the Claude Code CLI as a PERSISTENT process per canvas.
 *
 * One `claude --input-format stream-json --output-format stream-json` process is
 * spawned per open canvas and kept alive. Each user message is a turn written to
 * stdin; events stream back on stdout until a `result` event ends the turn. The
 * process keeps the conversation in memory, so global hooks load once (not per
 * message) and the prompt cache stays warm.
 *
 * Auth: the user's existing `claude` /login — NO API key.
 * Permissions: `default` mode (guarded) — non-allowlisted dangerous tools are
 *   denied by CC; the user's allowlist governs what runs.
 * Tools: the CLI runs them via the deployed skena MCP server + the user's own
 *   MCP servers; canvas mutations land on disk → the editor's watcher reloads.
 *
 * Verified 2026-06-30: keyless auth, persistent multi-turn memory, and stream-json
 * input all work from the extension host.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { ILLMClient, LLMMessage, LLMTool, LLMCallbacks, LLMContext, LLMUsage } from '../llm-client';

const FALLBACK_BIN = path.join(os.homedir(), '.local', 'bin', 'claude');

// - turn raw child stderr into a clean, user-facing chat error. Full stderr still goes
// - to the "Skena AI (harness)" output channel; the chat should not show spawn logs or
// - multi-line noise. Auth failures get an actionable hint.
function cleanError(stderr: string, fallback: string): string {
  const raw = stderr.trim();
  if (/oauth|authenticate|credentials|not logged in|401|token.*expired|session expired/i.test(raw)) {
    return 'Claude Code authentication expired. Run /login in a terminal, then press Reset (⟲) in the chat.';
  }
  if (!raw) return fallback;
  // - drop skena's own spawn-log lines and blanks; show the last meaningful line
  const lines = raw.split('\n').map(l => l.trim())
    .filter(l => l && !/^\[\d{4}-\d\d-\d\d[ T]/.test(l) && !/^spawn:/.test(l));
  const last = lines.length ? lines[lines.length - 1] : fallback;
  return last.length > 300 ? last.slice(0, 300) + '…' : last;
}

// - flatten a tool_result content payload to a short display string
function previewToolResult(content: unknown): string {
  let s: string;
  if (typeof content === 'string') s = content;
  else if (Array.isArray(content)) s = content.map(c => (c && typeof c === 'object' && 'text' in c) ? String((c as { text: unknown }).text) : '').join('');
  else s = content == null ? '' : JSON.stringify(content);
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

interface HarnessSession {
  proc:          ChildProcess;
  buf:           string;
  cb:            LLMCallbacks | null;   // - callbacks for the in-flight turn (null = idle)
  onSessionId?:  (id: string) => void;
  anyText:       boolean;
  lastResultText: string;
  isError:       boolean;
  aborted:       boolean;
  stderr:        string;
  sessionId:     string;
  usedResume:    boolean;               // - spawned with --resume (for fallback detection)
  everSucceeded: boolean;               // - got at least one successful result
  pendingMessage: string;               // - last message (replayed on resume-fail respawn)
  bin:           string;
  cwd:           string;
  freshArgs:     string[];              // - spawn args WITHOUT --resume (for respawn)
  configDir?:    string;                // - isolated CLAUDE_CONFIG_DIR (no global hooks)
  lastTotalCost: number;                // - cumulative total_cost_usd after previous turn
  turnUsage:     LLMUsage | null;       // - cost of the just-finished turn (for onDone)
}

export class HarnessAdapter implements ILLMClient {
  private _sessions = new Map<string, HarnessSession>();
  private _out: vscode.OutputChannel | null = null;

  constructor() {
    // - safety net: kill child processes if the extension host exits abnormally
    process.once('exit', () => this.killAllSync());
  }

  private killAllSync(): void {
    for (const s of this._sessions.values()) { try { s.proc.kill(); } catch { /* gone */ } }
  }

  private log(msg: string): void {
    if (!this._out) this._out = vscode.window.createOutputChannel('Skena AI (harness)');
    // - UTC, second precision — enough to correlate with cache-TTL gaps
    this._out.appendLine(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${msg}`);
  }

  invalidate(): void { /* - settings read per spawn */ }

  disposeAll(): void {
    this.log(`disposing ${this._sessions.size} harness session(s)`);
    this.killAllSync();
    this._sessions.clear();
  }

  // - soft abort: stop forwarding the active turn; the process finishes it in the
  // - background (kept alive so the session survives). Frees the UI on next result.
  abort(): void {
    for (const s of this._sessions.values()) {
      if (s.cb) { s.aborted = true; s.cb.onDone(); s.cb = null; }
    }
  }

  disposeSession(canvasPath: string): void {
    const s = this._sessions.get(canvasPath);
    if (s) { try { s.proc.kill(); } catch { /* already gone */ } this._sessions.delete(canvasPath); }
  }

  resetSession(canvasPath: string): void {
    // - kill the process; next chat() respawns fresh (caller clears the stored id so no --resume)
    this.disposeSession(canvasPath);
    this.log(`session reset for ${path.basename(canvasPath)}`);
  }

  async chat(
    systemPrompt: string,
    history:      LLMMessage[],
    _tools:       LLMTool[],
    callbacks:    LLMCallbacks,
    context?:     LLMContext,
  ): Promise<void> {
    const canvasPath   = context?.canvasPath;
    const workspaceDir = context?.workspaceDir;
    if (!canvasPath || !workspaceDir) {
      callbacks.onError('Harness provider needs a workspace-resident canvas (canvasPath/workspaceDir missing).');
      return;
    }

    const message = history[history.length - 1]?.content ?? '';
    if (!message) { callbacks.onError('Empty message.'); return; }

    let s = this._sessions.get(canvasPath);
    if (s && (s.proc.killed || s.proc.exitCode !== null)) { this._sessions.delete(canvasPath); s = undefined; }

    if (!s) {
      const spawned = this.spawnSession(canvasPath, workspaceDir, systemPrompt, callbacks, context);
      if (!spawned) return;  // - spawn error already reported
      s = spawned;
    }

    if (s.cb) { callbacks.onError('Still working on the previous message — please wait or stop it.'); return; }

    this.beginTurn(s, message, callbacks);
  }

  /** - send `/compact` as a turn to summarise the live session (no-op if none) */
  compact(canvasPath: string, callbacks: LLMCallbacks): void {
    const s = this._sessions.get(canvasPath);
    if (!s) { callbacks.onError('No active session to compact.'); return; }
    if (s.cb) { callbacks.onError('Still working — wait before compacting.'); return; }
    this.beginTurn(s, '/compact', callbacks);
  }

  private spawnSession(
    canvasPath:   string,
    workspaceDir: string,
    systemPrompt: string,
    callbacks:    LLMCallbacks,
    context?:     LLMContext,
  ): HarnessSession | null {
    const mcpJs = path.join(workspaceDir, '.vscode', 'skena-mcp.js');
    if (!fs.existsSync(mcpJs)) {
      callbacks.onError(`skena MCP server not found at ${mcpJs}. Reopen the workspace to redeploy it.`);
      return null;
    }

    const cfg      = vscode.workspace.getConfiguration('skena.ai');
    const bin      = cfg.get<string>('harnessPath')?.trim() || 'claude';
    const model    = cfg.get<string>('model') ?? 'claude-sonnet-4-5';
    const permMode = cfg.get<string>('harnessPermissionMode') ?? 'acceptEdits';
    const maxTurns = cfg.get<number>('harnessMaxTurns') ?? 16;
    const system   = `${systemPrompt}\n\n${harnessDirective(canvasPath)}`;

    // - isolate from the user's global ~/.claude (drops the per-message SessionStart
    // - hook tax) while keeping keyless auth + their MCP servers (re-injected below)
    const isolate   = cfg.get<boolean>('harnessIsolate') ?? true;
    const configDir = isolate ? this.prepareProfile() : undefined;

    let mcpConfigPath: string;
    try {
      mcpConfigPath = this.writeMcpConfig(workspaceDir, mcpJs, /*includeUserServers*/ !!configDir);
    } catch (e) {
      callbacks.onError(`Failed to write MCP config: ${(e as Error).message}`);
      return null;
    }

    const freshArgs = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--print',
      '--model', model,
      '--permission-mode', permMode,
      '--max-turns', String(maxTurns),
      '--system-prompt', system,
      '--exclude-dynamic-system-prompt-sections',
      '--mcp-config', mcpConfigPath,   // - skena (+ user's servers when isolated)
    ];
    // - grant filesystem access beyond the canvas workspace (vaults + user dirs)
    // - so the companion can read/write research material. Skipped under bypass
    // - (which already ignores the directory sandbox).
    if (permMode !== 'bypassPermissions') {
      // - always allow the skena canvas tools (the companion's own functions); plus the
      // - user's listed tools (Bash etc.). Headless can't prompt, so un-allowed = denied.
      const allowed = ['mcp__skena', ...(cfg.get<string[]>('harnessAllowedTools') ?? [])];
      freshArgs.push('--allowedTools', ...allowed);
      for (const dir of this.accessDirs()) { freshArgs.push('--add-dir', dir); }
    }
    if (configDir) freshArgs.push('--strict-mcp-config');   // - isolated: only the merged config loads

    const resumeId = context?.restoreSession && context?.sessionId ? context.sessionId : null;
    const args = resumeId ? [...freshArgs, '--resume', resumeId] : freshArgs;

    const proc = this.launch(bin, args, workspaceDir, configDir);
    if (!proc) { callbacks.onError(`Failed to launch '${bin}'.`); return null; }

    const s: HarnessSession = {
      proc, buf: '', cb: null, onSessionId: callbacks.onSessionId,
      anyText: false, lastResultText: '', isError: false, aborted: false, stderr: '',
      sessionId: '', usedResume: !!resumeId, everSucceeded: false, pendingMessage: '',
      bin, cwd: workspaceDir, freshArgs, configDir,
      lastTotalCost: 0, turnUsage: null,
    };
    this.wire(canvasPath, s);
    this._sessions.set(canvasPath, s);
    this.log(`spawn: ${bin} (cwd=${workspaceDir}, ${args.length} args${resumeId ? ', --resume' : ''}${configDir ? ', isolated' : ''})`);
    return s;
  }

  /** - extra directories the companion may read/write: configured vaults + user list */
  private accessDirs(): string[] {
    const expand = (p: string) => p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    const vaults = (vscode.workspace.getConfiguration('skena').get<Array<{ path?: string }>>('vaults') ?? [])
      .map(v => v.path).filter((p): p is string => !!p);
    const extra  = vscode.workspace.getConfiguration('skena.ai').get<string[]>('harnessAddDirs') ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of [...vaults, ...extra]) {
      const abs = expand(d);
      if (!seen.has(abs) && fs.existsSync(abs)) { seen.add(abs); out.push(abs); }
    }
    return out;
  }

  private launch(bin: string, args: string[], cwd: string, configDir?: string): ChildProcess | null {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;   // - else the node-based CLI misbehaves under Electron
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir;   // - isolated profile (no global hooks)
    try {
      return spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      if (bin !== FALLBACK_BIN) return this.launch(FALLBACK_BIN, args, cwd, configDir);
      return null;
    }
  }

  /**
   * - isolated CC profile: a stable config dir with the user's creds copied in
   * - (keyless auth) but NO settings.json → the global SessionStart hooks don't
   * - fire, eliminating the ~20k-token-per-message tax. Returns undefined (use
   * - global config) if creds can't be staged.
   */
  private prepareProfile(): string | undefined {
    const claudeDir = path.join(os.homedir(), '.claude');
    const profile   = path.join(os.homedir(), '.skena', 'cc-profile');
    const srcCreds  = path.join(claudeDir, '.credentials.json');
    try {
      if (!fs.existsSync(srcCreds)) { this.log('no global creds to stage — using global config'); return undefined; }
      fs.mkdirSync(profile, { recursive: true });
      // - SYMLINK creds (don't copy): the profile then always reads the LIVE global
      // - credentials, so a re-login or token refresh in ~/.claude is picked up
      // - immediately. Copying left them stale until the next respawn → every message
      // - failed with "OAuth session expired" after a re-login. Re-established each spawn
      // - (an atomic cred-write by CC may replace the link with a real file; the next
      // - spawn restores the link). Falls back to copy if symlinks are unsupported.
      const dstCreds = path.join(profile, '.credentials.json');
      try { fs.rmSync(dstCreds, { force: true }); } catch { /* absent */ }
      try {
        fs.symlinkSync(srcCreds, dstCreds);
      } catch (e) {
        this.log(`creds symlink failed (${(e as Error).message}) — copying instead`);
        fs.copyFileSync(srcCreds, dstCreds);
      }
      this.syncProfile(profile, claudeDir);
      return profile;
    } catch (e) {
      this.log(`profile setup failed (${(e as Error).message}) — using global config`);
      return undefined;
    }
  }

  /**
   * - bring the user's CC ecosystem into the isolated profile: symlink (live)
   * - agents/commands/skills + global CLAUDE.md, and copy settings.json with
   * - `hooks` stripped — so the companion keeps the user's agents/skills/memory
   * - WITHOUT the SessionStart hook tax. Plugins are deliberately NOT linked
   * - (their hooks would re-introduce the tax).
   */
  private syncProfile(profile: string, claudeDir: string): void {
    for (const name of ['agents', 'commands', 'skills', 'CLAUDE.md']) {
      const src = path.join(claudeDir, name);
      const dst = path.join(profile, name);
      if (!fs.existsSync(src)) continue;
      try {
        const st = fs.lstatSync(dst);
        if (st.isSymbolicLink()) fs.unlinkSync(dst);   // - refresh stale link
        else continue;                                  // - real file/dir present → don't clobber
      } catch { /* dst absent */ }
      try { fs.symlinkSync(src, dst); } catch (e) { this.log(`link ${name} failed: ${(e as Error).message}`); }
    }
    // - settings.json minus hooks (keeps permissions/allowlist; drops the tax)
    try {
      const j = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
      delete j.hooks;
      fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(j, null, 2));
    } catch { /* no global settings — fine */ }
  }

  /** - write the MCP config: skena server + (when isolated) the user's own servers */
  private writeMcpConfig(workspaceDir: string, mcpJs: string, includeUserServers: boolean): string {
    const servers: Record<string, unknown> = { skena: { type: 'stdio', command: 'node', args: [mcpJs] } };
    if (includeUserServers) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
        for (const [k, v] of Object.entries(j.mcpServers ?? {})) { if (k !== 'skena') servers[k] = v; }
      } catch { /* - no user servers to carry over */ }
    }
    const p = path.join(os.tmpdir(), `skena-mcp-${hashPath(workspaceDir)}.json`);
    fs.writeFileSync(p, JSON.stringify({ mcpServers: servers }));
    return p;
  }

  private beginTurn(s: HarnessSession, message: string, callbacks: LLMCallbacks): void {
    s.cb = callbacks;
    s.anyText = false; s.lastResultText = ''; s.isError = false; s.aborted = false; s.stderr = '';
    s.pendingMessage = message;
    const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: message } });
    try {
      s.proc.stdin!.write(payload + '\n');
    } catch (e) {
      s.cb = null;
      callbacks.onError(`Failed to send message: ${(e as Error).message}`);
    }
  }

  private wire(canvasPath: string, s: HarnessSession): void {
    s.proc.stdout!.on('data', (chunk: Buffer) => {
      s.buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = s.buf.indexOf('\n')) >= 0) {
        const line = s.buf.slice(0, nl).trim();
        s.buf = s.buf.slice(nl + 1);
        if (line) this.onEvent(canvasPath, s, line);
      }
    });
    s.proc.stderr!.on('data', (chunk: Buffer) => { s.stderr += chunk.toString('utf8'); });
    s.proc.on('close', (code) => this.onClose(canvasPath, s, code));
    s.proc.on('error', (err) => { this.log(`process error: ${err.message}`); });
  }

  private onEvent(canvasPath: string, s: HarnessSession, line: string): void {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { return; }

    switch (ev['type']) {
      case 'system':
        if (ev['subtype'] === 'init') {
          if (typeof ev['session_id'] === 'string') s.sessionId = ev['session_id'];
          this.log(`init: apiKeySource=${ev['apiKeySource']} model=${ev['model']} session=${s.sessionId}`);
        }
        break;
      case 'assistant': {
        const msg = ev['message'] as {
          content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
          usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        } | undefined;
        if (msg?.usage && !s.aborted) {
          s.cb?.onUsage?.({
            inputTokens:       msg.usage.input_tokens ?? 0,
            outputTokens:      msg.usage.output_tokens ?? 0,
            cacheReadTokens:   msg.usage.cache_read_input_tokens ?? 0,
            cacheCreateTokens: msg.usage.cache_creation_input_tokens ?? 0,
          });
        }
        for (const item of msg?.content ?? []) {
          if (s.aborted) break;
          if (item.type === 'text' && item.text) { s.cb?.onText(item.text); s.anyText = true; }
          else if (item.type === 'thinking' && item.thinking) { s.cb?.onToolEvent?.({ kind: 'thinking', content: item.thinking }); }
          else if (item.type === 'tool_use' && item.id && item.name) { s.cb?.onToolEvent?.({ kind: 'use', id: item.id, name: item.name, input: item.input }); }
        }
        break;
      }
      case 'user': {
        if (s.aborted) break;
        const msg = ev['message'] as {
          content?: Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>;
        } | undefined;
        for (const item of msg?.content ?? []) {
          if (item.type === 'tool_result' && item.tool_use_id) {
            s.cb?.onToolEvent?.({ kind: 'result', id: item.tool_use_id, ok: item.is_error !== true, preview: previewToolResult(item.content) });
          }
        }
        break;
      }
      case 'result': {
        s.isError = ev['is_error'] === true;
        s.lastResultText = typeof ev['result'] === 'string' ? (ev['result'] as string) : '';
        if (typeof ev['session_id'] === 'string') s.sessionId = ev['session_id'];
        // - per-turn cost delta; a resumed/fresh process restarts its cumulative counter,
        // - so a total below the previous one means "counter reset" → delta = total
        const total = typeof ev['total_cost_usd'] === 'number' ? ev['total_cost_usd'] : NaN;
        if (Number.isFinite(total)) {
          const delta = total >= s.lastTotalCost ? total - s.lastTotalCost : total;
          s.turnUsage = { costUsd: total, deltaUsd: delta };
          s.lastTotalCost = total;
        } else {
          s.turnUsage = null;
        }
        const subtype = typeof ev['subtype'] === 'string' ? ev['subtype'] : '?';
        this.log(
          `result: is_error=${s.isError} subtype=${subtype} num_turns=${ev['num_turns']} ` +
          `delta_usd=${s.turnUsage ? s.turnUsage.deltaUsd.toFixed(4) : '?'} total_usd=${s.turnUsage ? s.turnUsage.costUsd.toFixed(4) : '?'} ` +
          `session=${s.sessionId}`
        );
        // - the error reason lives only in this envelope — log it or lose it
        if (s.isError) this.log(`  error detail: ${(s.lastResultText || s.stderr || '(none)').slice(0, 400)}`);
        this.finishTurn(canvasPath, s, subtype);
        break;
      }
    }
  }

  /**
   * - resume of a stale/foreign session id failed (e.g. the id was created under a
   * - different config dir before isolation) → kill it, start a FRESH session and
   * - replay the pending message. Self-heals: the new id is then persisted.
   */
  private respawnFresh(canvasPath: string, s: HarnessSession, cb: LLMCallbacks): boolean {
    if (!s.usedResume || s.everSucceeded) return false;
    try { s.proc.kill(); } catch { /* already gone */ }
    this.log('resume failed — starting a fresh session');
    const proc = this.launch(s.bin, s.freshArgs, s.cwd, s.configDir);
    if (!proc) return false;
    const fresh: HarnessSession = {
      ...s, proc, buf: '', usedResume: false, cb: null,
      anyText: false, lastResultText: '', isError: false, aborted: false, stderr: '',
      lastTotalCost: 0, turnUsage: null,   // - fresh process restarts its cost counter
    };
    this.wire(canvasPath, fresh);
    this._sessions.set(canvasPath, fresh);
    this.beginTurn(fresh, s.pendingMessage, cb);
    return true;
  }

  private finishTurn(canvasPath: string, s: HarnessSession, subtype?: string): void {
    const cb = s.cb;
    s.cb = null;
    if (s.isError) {
      // - a failed --resume surfaces as an is_error result (process stays alive)
      if (cb && this.respawnFresh(canvasPath, s, cb)) return;
      const msg = subtype === 'error_max_turns'
        ? 'Hit the per-message turn cap (skena.ai.harnessMaxTurns) — the reply above may be truncated. Raise the setting or send "continue".'
        : cleanError(s.stderr, s.lastResultText || 'Claude reported an error.');
      cb?.onError(msg);
      return;
    }
    s.everSucceeded = true;
    if (s.sessionId) s.onSessionId?.(s.sessionId);
    if (cb && !s.aborted) {
      if (!s.anyText && s.lastResultText) cb.onText(s.lastResultText);
      cb.onDone(s.turnUsage ?? undefined);
    }
  }

  private onClose(canvasPath: string, s: HarnessSession, code: number | null): void {
    if (this._sessions.get(canvasPath) !== s) return;   // - superseded by a respawn; ignore
    this._sessions.delete(canvasPath);
    const cb = s.cb;
    if (!cb) return;   // - idle process exit (e.g. disposed) — nothing to report
    s.cb = null;
    // - resume failed before first success (process exited) → recover fresh
    if (this.respawnFresh(canvasPath, s, cb)) return;
    cb.onError(cleanError(s.stderr, `claude exited with code ${code}`));
  }
}

/** - authoritative tool directive; set once in the spawn --system-prompt */
function harnessDirective(canvasPath: string): string {
  return [
    '## Canvas tools (authoritative)',
    'You operate this canvas through the `skena` MCP tools.',
    `The current canvas file is at: ${canvasPath}`,
    'You MUST pass canvasPath="' + canvasPath + '" as an argument to EVERY skena canvas tool.',
    '',
    '- canvas_add_node + canvas_add_edge — capture findings as notes, connected to the focused node',
    '- canvas_read / canvas_list / canvas_search / canvas_edges / canvas_follow — explore the canvas',
    '- canvas_update_node / canvas_remove_node — edit or remove existing nodes',
    '',
    'Each user message includes the current canvas snapshot (focused node + connections). File nodes appear as a filesystem path — open them with your Read tool when you need their content (handles notebooks/large files cleanly).',
    '',
    'When you reach an insight worth keeping, add it as a concise note connected to the currently focused node.',
  ].join('\n');
}

/** - short stable token from a path, for temp-file naming */
function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h * 31 + p.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
