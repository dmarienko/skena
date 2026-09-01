/**
 * SkenaEditorProvider — custom editor for *.canvas files.
 *
 * One panel per open .canvas document. Manages:
 * - Webview HTML shell + React app bootstrap
 * - Message routing between extension host and webview
 * - File content serving (reads files, converts to webview URIs)
 * - Canvas read/write with debounced auto-save
 * - File change notifications to webview
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { readCanvas, writeCanvas } from './canvas-io';
import { FileResolver } from './file-resolver';
import { VaultIndexer } from './vault-indexer';
import { FileWatcher } from './file-watcher';
import { parseNotebook } from './notebook-parser';
import { renderMarkdownToHtml } from './markdown-html';
import { getVaults } from './settings';
import { createLLMClient, CANVAS_TOOLS, ILLMClient } from './llm-client';
import { buildSystemPrompt, buildStaticSystemPrompt, buildCanvasContext, nodeTitle, nodeContent } from './context-builder';
import { assignLabel } from '../shared/nodeLabels';
import { resolveBoundKernel, resolveUpstreamChain, resolveKernelCells } from '../shared/kernelBinding';
import { KernelManager } from './jupyter/manager';
import { listKernels, startKernel, listKernelSpecs, listSessions } from './jupyter/client';
import { canvasSessionName } from './llm-adapters/harness';
import type { CollectedOutput } from './jupyter/protocol';
import { renderOutput, hasVisibleOutput } from './jupyter/output';
import {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  FileNode,
  TextNode,
  LinkNode,
  PortalNode,
  CellNode,
  CodeNode,
  KernelNode,
  KernelStatusEntry,
  MsgRunCell,
  MsgInterruptCell,
  HostToWebview,
  WebviewToHost,
  MsgRequestFile,
  MsgSaveCanvas,
  MsgOpenFile,
  MsgSearchVault,
  MsgChatMessage,
  MsgAddNodeRequest,
  MsgAddKernel,
  MsgMoveToSubCanvas,
  MsgFloatingChatSend,
  MsgFloatingChatPersistHistory,
  ChatItem,
  MsgFloatingChatHistoryRestored,
  MsgFloatingChatSaveUIState,
  MsgSaveMarks,
  MsgMarksRestored,
  CanvasMark,
  MsgFocusNode,
  AgentRunPersist,
  AgentRunPersistResult,
} from '../shared/types';
import { parseNodeRef } from '../shared/nodeRef';
import { MAX_FILE_FULL_BYTES, MAX_FILE_PREVIEW_BYTES, MAX_NOTEBOOK_BYTES, NODE_SIZE } from '../shared/constants';
import { normalizeCanvasToOrigin } from '../shared/bounds';
import { wrapNodesInSection } from '../shared/sections';

// ─── bookmarks file helpers ──────────────────────────────────────────────────

interface BookmarksFile {
  version: 1;
  /** - key: path relative to workspace root (or full URI string if outside workspace) */
  canvases: Record<string, Record<string, CanvasMark>>;
}

function bookmarksFilePath(wsRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(wsRoot, '.vscode', 'skena-bookmarks.json');
}

function canvasBookmarkKey(canvasUri: vscode.Uri, wsRoot: vscode.Uri): string {
  const ws  = wsRoot.fsPath.replace(/\\/g, '/').replace(/\/?$/, '/');
  const cvs = canvasUri.fsPath.replace(/\\/g, '/');
  return cvs.startsWith(ws) ? cvs.slice(ws.length) : canvasUri.toString();
}

async function readBookmarksFile(wsRoot: vscode.Uri): Promise<BookmarksFile> {
  try {
    const raw  = await vscode.workspace.fs.readFile(bookmarksFilePath(wsRoot));
    const data = JSON.parse(Buffer.from(raw).toString('utf8')) as BookmarksFile;
    return data.version === 1 ? data : { version: 1, canvases: {} };
  } catch {
    return { version: 1, canvases: {} };
  }
}

async function writeBookmarksFile(wsRoot: vscode.Uri, data: BookmarksFile): Promise<void> {
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
  await vscode.workspace.fs.writeFile(bookmarksFilePath(wsRoot), content);
}

export class SkenaEditorProvider implements vscode.CustomEditorProvider<SkenaDocument> {
  static readonly viewType = 'skena.canvasEditor';

  /**
   * Active panel reference — updated via onDidChangeViewState so the
   * skena.addNode VS Code command can post a trigger to the focused canvas.
   */
  static activePanel: vscode.WebviewPanel | null = null;

  // - canvasPath (document.uri.fsPath) → its open panel, so the run-ipc relay can forward an
  // - out-of-process agent run's live output to the right webview.
  static panelsByPath = new Map<string, vscode.WebviewPanel>();

  // - canvasPath → the host-side persist function for an agent run. When present, the MCP delegates
  // - the .canvas WRITE here (single-writer) instead of writing the file itself, killing the
  // - two-writer race that duplicated output nodes. Absent → MCP falls back to its own writeCanvas.
  static agentPersistByPath = new Map<string, { panel: vscode.WebviewPanel; fn: (payload: AgentRunPersist) => Promise<AgentRunPersistResult> }>();

  // - canvasPath (fsPath) → nodeLabel to focus once that canvas's webview reports ready
  private pendingFocus = new Map<string, string>();

  /** - lazily-created LLM client; null until first chat request */
  private _llmClient: ILLMClient | null = null;

  private async llmClient(): Promise<ILLMClient> {
    if (!this._llmClient) this._llmClient = await createLLMClient();
    return this._llmClient;
  }

  /** - called from deactivate(): kill any persistent harness processes */
  dispose(): void {
    this._llmClient?.disposeAll?.();
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly indexer: VaultIndexer,
    private readonly watcher: FileWatcher,
  ) {}

  // ─── CustomEditorProvider ────────────────────────────────────────────────────

  async openCustomDocument(uri: vscode.Uri): Promise<SkenaDocument> {
    return new SkenaDocument(uri);
  }

  async resolveCustomEditor(
    document: SkenaDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const vaults    = await getVaults();
    const canvasDir = path.dirname(document.uri.fsPath);
    const resolver = new FileResolver(vaults);

    // - flag to suppress file watcher events triggered by our own saves
    let isSelfSaving = false;
    // - the last few JSONs WE wrote. A watcher event whose disk content matches ANY of these is our
    // - own echo — remembering several (not one) is essential because the host's run writes and the
    // - webview's saves interleave, so `disk` may still hold an earlier of OUR writes when its
    // - watcher event finally fires. One slot got clobbered by the other writer → spurious reload.
    const recentWrites: string[] = [];
    let   lastWrittenJson = '';
    const rememberWrite = (s: string) => {
      lastWrittenJson = s;
      recentWrites.push(s);
      if (recentWrites.length > 8) recentWrites.shift();
    };

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(canvasDir),
        // - vault root + its parent: vault files often reference images via ../images/
        // - or ../attachments/ (standard Obsidian layout where attachments live
        // - in a sibling directory to the vault folder).
        ...vaults.flatMap(v => {
          const root = v.path.startsWith('~')
            ? path.join(process.env.HOME ?? '~', v.path.slice(1))
            : v.path;
          return [vscode.Uri.file(root), vscode.Uri.file(path.dirname(root))];
        }),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    panel.webview.html = this.getWebviewHtml(panel.webview);

    // - send initial canvas data once webview signals ready. Guard against a disposed panel: an
    // - async kernel poll (or run) can resolve AFTER the panel closes and post to a dead webview,
    // - which throws an uncaught "Webview is disposed" (floods on reload). No-op once disposed.
    let panelDisposed = false;
    const send = (msg: HostToWebview) => {
      if (panelDisposed) return;
      try { panel.webview.postMessage(msg); } catch { /* - panel disposed mid-async */ }
    };

    // - one Jupyter kernel manager per panel; pushes status to the webview.
    // - one-shot on open: reconcile run-flags against the live kernels — a bound kernel that died
    // - while the canvas was closed (external restart/timeout) means a wiped namespace, so its cells
    // - must re-run. Only the first poll, and only when the kernel's server actually responded.
    let reconciledFlags = false;
    const manager = new KernelManager(kernels => {
      send({ type: 'kernelStatus', kernels });
      if (!reconciledFlags) { reconciledFlags = true; void this.reconcileRunFlags(document, kernels); }
    });

    // - handle messages from webview
    panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      switch (msg.type) {
        case 'webviewReady': {
          // - webview is mounted and listening — now safe to send canvas data
          try {
            // - read canvas and clipboard in parallel; clipboard pre-warm ensures
            // - that vim's `p` works immediately on first open even in a fresh
            // - cross-canvas webview where clipboardCache starts empty.
            const [rawCanvas, clipboardText] = await Promise.all([
              readCanvas(document.uri.fsPath),
              vscode.env.clipboard.readText(),
            ]);
            const canvas = normalizeCanvasToOrigin(wrapNodesInSection(rawCanvas));
            document.updateFromDisk(canvas);
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
            // - a cross-canvas node reference opened this canvas — focus the referenced node now
            // - that the webview has parsed it (document.canvas isn't ready any earlier than this)
            {
              const wantLabel = this.pendingFocus.get(document.uri.fsPath);
              if (wantLabel) {
                const target = document.canvas.nodes.find(n => n.nodeLabel === wantLabel);
                if (target) send({ type: 'focusNode', id: target.id } satisfies MsgFocusNode);
                else vscode.window.showWarningMessage(`Skena: ${wantLabel} not found in ${path.basename(document.uri.fsPath)}`);
                this.pendingFocus.delete(document.uri.fsPath);
              }
            }
            // - push clipboard content unprompted; webview caches it in clipboardCache
            // - so vim paste works before any requestClipboardRead round-trip completes
            send({ type: 'clipboardContent', text: clipboardText });
            send({ type: 'vaultIndex', entries: this.indexer.all() });
            // - current AI model/provider for the chat title
            const aiCfg0 = vscode.workspace.getConfiguration('skena.ai');
            send({ type: 'chatModelInfo', model: document.canvas.metadata?.aiModel || aiCfg0.get<string>('model') || '', provider: aiCfg0.get<string>('provider') ?? '', sessionName: this.sessionNameFor(document) });
            // - restore chat state from workspaceState (survives panel close + rename)
            const historyKey = `skena.chatHistory.${document.uri.toString()}`;
            const uiKey      = `skena.chatUI.${document.uri.toString()}`;
            const savedHistory = this.context.workspaceState.get<unknown[]>(historyKey) ?? [];
            const savedUI      = this.context.workspaceState.get<{ collapsed?: boolean; pos?: { x: number; y: number }; size?: { w: number; h: number }; inputW?: number }>(uiKey);
            send({
              type:      'floatingChatHistoryRestored',
              history:   savedHistory as ChatItem[],
              collapsed: true,              // - always start collapsed; user opens explicitly
              pos:       savedUI?.pos,
              size:      savedUI?.size,
              inputW:    savedUI?.inputW,
            } satisfies MsgFloatingChatHistoryRestored);
            // - restore canvas marks (vim-style bookmarks) from .vscode/skena-bookmarks.json
            {
              const wsFolder  = vscode.workspace.getWorkspaceFolder(document.uri);
              let savedMarks: Record<string, CanvasMark> = {};
              if (wsFolder) {
                const bf  = await readBookmarksFile(wsFolder.uri);
                const key = canvasBookmarkKey(document.uri, wsFolder.uri);
                savedMarks = bf.canvases[key] ?? {};
              } else {
                // - fallback: workspaceState for untitled / out-of-workspace canvases
                const marksKey = `skena.marks.${document.uri.toString()}`;
                savedMarks = this.context.workspaceState.get<Record<string, CanvasMark>>(marksKey) ?? {};
              }
              send({ type: 'marksRestored', marks: savedMarks } satisfies MsgMarksRestored);
            }
            // - forward VS Code markdown preview settings so the webview matches the editor look
            const mdPreview = vscode.workspace.getConfiguration('markdown.preview');
            const md        = vscode.workspace.getConfiguration('markdown');
            const nbCfg     = vscode.workspace.getConfiguration('skena').get<{ showSourceCells?: boolean }>('notebook') ?? {};
            const mdTheme   = vscode.workspace.getConfiguration('skena').get<'vscode' | 'factors'>('markdownTheme') ?? 'vscode';
            const mdMaxW    = vscode.workspace.getConfiguration('skena').get<number>('markdownMaxWidth') ?? 0;
            send({
              type: 'markdownConfig',
              config: {
                fontFamily:         mdPreview.get<string>('fontFamily'),
                fontSize:           mdPreview.get<number>('fontSize'),
                styles:             md.get<string[]>('styles') ?? [],
                notebookShowSource: nbCfg.showSourceCells ?? false,
                theme:              mdTheme,
                maxWidth:           mdMaxW,
              },
            });
          } catch (e) {
            vscode.window.showErrorMessage(`Skena: failed to open canvas: ${e}`);
          }
          // - webview is live — begin polling Jupyter kernel status
          manager.startPolling();
          break;
        }
        case 'requestFile':  await this.handleRequestFile(msg, panel, document, resolver, canvasDir); break;
        case 'saveCanvas':   await this.handleSaveCanvas(msg, document, v => { isSelfSaving = v; }, s => rememberWrite(s)); break;
        case 'openFile':     await this.handleOpenFile(msg, resolver, canvasDir); break;
        case 'searchVault':  {
          const results = this.indexer.search(msg.query);
          send({ type: 'searchResults', requestId: msg.requestId, results });
          break;
        }
        case 'refreshVault': {
          await this.indexer.reindex(vaults);
          send({ type: 'vaultIndex', entries: this.indexer.all() });
          break;
        }
        case 'chatMessage':          await this.handleChatMessage(msg, panel); break;
        case 'floatingChatSend':  await this.handleFloatingChatSend(msg, panel, document, canvasDir, resolver); break;
        case 'floatingChatAbort': this._llmClient?.abort(); break;
        case 'pickModel': {
          const aiCfg = vscode.workspace.getConfiguration('skena.ai');
          const cur   = document.canvas.metadata?.aiModel || aiCfg.get<string>('model') || '';
          // - aliases the `claude` CLI resolves to the latest of each family (see `claude --help`
          // - `--model`), so this list never rots as new model versions ship. Custom… pins an exact id.
          const MODELS: Array<[string, string]> = [
            ['opus',   'latest Opus'],
            ['sonnet', 'latest Sonnet'],
            ['haiku',  'latest Haiku'],
            ['fable',  'latest Fable'],
            ['opusplan', 'Opus to plan, Sonnet to execute'],
          ];
          const items: vscode.QuickPickItem[] = [
            ...MODELS.map(([m, d]) => ({ label: m, description: m === cur ? `${d} · ● current` : d })),
            { label: 'Custom…', description: 'type an exact model id, e.g. claude-opus-4-5' },
            { label: 'Use global default', description: `skena.ai.model = ${aiCfg.get<string>('model') ?? ''}` },
          ];
          const pick = await vscode.window.showQuickPick(items, { title: 'AI model for this canvas', placeHolder: cur ? `current: ${cur}` : 'select a model' });
          if (!pick) break;
          let chosen: string | undefined = pick.label;
          if (pick.label === 'Custom…') {
            chosen = (await vscode.window.showInputBox({ title: 'Model id', value: cur, prompt: 'e.g. claude-sonnet-4-5' }))?.trim();
            if (!chosen) break;
          } else if (pick.label === 'Use global default') {
            chosen = undefined;   // - clear the per-canvas override
          }
          // - persist in the .canvas file (portable), respawn so the new model takes effect
          document.canvas.metadata = { ...(document.canvas.metadata ?? {}), aiModel: chosen };
          await writeCanvas(document.uri.fsPath, document.canvas);
          this._llmClient?.resetSession?.(document.uri.fsPath);
          send({ type: 'chatModelInfo', model: chosen || aiCfg.get<string>('model') || '', provider: aiCfg.get<string>('provider') ?? '', sessionName: this.sessionNameFor(document) });
          break;
        }
        case 'floatingChatPersistHistory': {
          // - persist full history incl. the latest assistant reply (survives close/reopen)
          const historyKey = `skena.chatHistory.${document.uri.toString()}`;
          void this.context.workspaceState.update(historyKey, (msg as MsgFloatingChatPersistHistory).history ?? []);
          break;
        }
        case 'floatingChatReset': {
          // - destructive → native modal confirm; webview clears history only on the ack
          void vscode.window.showWarningMessage(
            'Reset the AI session? The conversation history and the live Claude session will be discarded.',
            { modal: true },
            'Reset',
          ).then(choice => {
            if (choice !== 'Reset') return;
            // - clear persisted session + history and kill the live CC process → next message starts fresh
            void this.context.workspaceState.update(`skena.chatSession.${document.uri.toString()}`, undefined);
            void this.context.workspaceState.update(`skena.chatHistory.${document.uri.toString()}`, []);
            this._llmClient?.resetSession?.(document.uri.fsPath);
            send({ type: 'floatingChatResetDone' });
          });
          break;
        }
        case 'floatingChatCompact': {
          void vscode.window.showWarningMessage(
            'Compact the AI session? The conversation is summarised in place — detail may be lost.',
            { modal: true },
            'Compact',
          ).then(choice => {
            if (choice !== 'Compact') return;
            send({ type: 'floatingChatCompacting', active: true });
            this._llmClient?.compact?.(document.uri.fsPath, {
              onText:    (delta) => send({ type: 'floatingChatDelta', delta }),
              onToolUse: async () => '',
              onDone:    (usage) => {
                send({ type: 'floatingChatCompacting', active: false });
                send({ type: 'floatingChatDone', costUsd: usage?.costUsd, deltaUsd: usage?.deltaUsd });
                void vscode.window.showInformationMessage('Skena: AI session compacted.');
              },
              onError:   (message) => {
                send({ type: 'floatingChatCompacting', active: false });
                send({ type: 'floatingChatError', message });
              },
              onToolEvent: (event) => send({ type: 'floatingChatToolEvent', event }),
              onUsage:     (usage) => send({ type: 'floatingChatUsage', usage }),
            });
          });
          break;
        }
        case 'floatingChatSaveUIState': {
          const uiKey = `skena.chatUI.${document.uri.toString()}`;
          void this.context.workspaceState.update(uiKey, {
            collapsed: (msg as MsgFloatingChatSaveUIState).collapsed,
            pos:       (msg as MsgFloatingChatSaveUIState).pos,
            size:      (msg as MsgFloatingChatSaveUIState).size,
            inputW:    (msg as MsgFloatingChatSaveUIState).inputW,
          });
          break;
        }
        case 'saveMarks': {
          const marks     = (msg as MsgSaveMarks).marks;
          const wsFolder  = vscode.workspace.getWorkspaceFolder(document.uri);
          if (wsFolder) {
            // - atomic read-modify-write into .vscode/skena-bookmarks.json
            const bf  = await readBookmarksFile(wsFolder.uri);
            const key = canvasBookmarkKey(document.uri, wsFolder.uri);
            bf.canvases[key] = marks;
            await writeBookmarksFile(wsFolder.uri, bf);
          } else {
            // - fallback for out-of-workspace canvases
            const marksKey = `skena.marks.${document.uri.toString()}`;
            void this.context.workspaceState.update(marksKey, marks);
          }
          break;
        }
        case 'dropFiles':            this.handleDropFiles(msg.uris, msg.position, canvasDir, resolver, send, msg.connectTo); break;
        case 'renderMarkdown': {
          try {
            const html = await renderMarkdownToHtml(msg.text);
            send({ type: 'renderMarkdownResult', requestId: msg.requestId, html });
          } catch {
            // - never reject: return an error span; webview falls back to its own render
            send({ type: 'renderMarkdownResult', requestId: msg.requestId, html: `<span class="typst-error">render failed</span>` });
          }
          break;
        }
        case 'addNodeRequest': await this.handleAddNodeRequest(msg, canvasDir, resolver, send); break;
        case 'moveToSubCanvas': await this.handleMoveToSubCanvas(msg, canvasDir, send); break;
        // - clipboard relay: webview sandbox blocks navigator.clipboard; route through host
        case 'requestClipboardRead': {
          const text = await vscode.env.clipboard.readText();
          send({ type: 'clipboardContent', text });
          break;
        }
        case 'writeClipboard': {
          await vscode.env.clipboard.writeText(msg.text);
          break;
        }
        case 'navigateFocus': {
          // - chat editor swallows some Alt+nav keys (Monaco's Alt+L find-in-selection);
          // - re-route to the matching VS Code focus-navigation command
          const cmd = { left: 'navigateLeft', right: 'navigateRight', up: 'navigateUp', down: 'navigateDown' }[msg.dir];
          await vscode.commands.executeCommand(`workbench.action.${cmd}`);
          break;
        }
        case 'copyAbsolutePath': {
          const resolved = resolver.resolve(msg.uri, canvasDir);
          if (resolved?.fsPath) {
            await vscode.env.clipboard.writeText(resolved.fsPath);
            vscode.window.setStatusBarMessage(`Copied: ${resolved.fsPath}`, 3000);
          }
          break;
        }
        case 'copyNodeReference': {
          const rel = `${this.sessionNameFor(document)}.canvas`;   // - sessionNameFor strips .canvas; re-add it
          await vscode.env.clipboard.writeText(`${rel}#${msg.label}`);
          vscode.window.setStatusBarMessage(`Skena: copied reference ${msg.label}`, 2000);
          break;
        }
        case 'verifyPath': {
          // - expand ~ and file://, answer with the same path convention dropFiles produces
          let p = msg.path.startsWith('file://') ? vscode.Uri.parse(msg.path).fsPath : msg.path;
          if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
          let exists = false;
          try { exists = (await fs.stat(p)).isFile(); } catch { /* - stays false */ }
          send({
            type: 'verifyPathResult',
            requestId: msg.requestId,
            exists,
            resolvedPath: exists
              ? resolver.resolveFromFsPath(p) ?? path.relative(canvasDir, p).replace(/\\/g, '/')
              : undefined,
          });
          break;
        }
        case 'showWarning':
          vscode.window.showWarningMessage(msg.text);
          break;
        case 'runCell':      await this.handleRunCell(msg, manager, panel, document, v => { isSelfSaving = v; }, s => rememberWrite(s)); break;
        case 'addKernel':    await this.handleAddKernel(msg, manager, document, send); break;
        case 'kernelAction': await this.handleKernelAction(msg, manager, document); break;
        case 'interruptCell': await this.handleInterruptCell(msg, manager, document); break;
        case 'confirmDelete': {
          const yes = await vscode.window.showWarningMessage(msg.reason, { modal: true }, 'Delete');
          send({ type: 'doDelete', confirmed: yes === 'Delete' });
          break;
        }
        case 'complete': await this.handleComplete(msg, manager, document, send); break;
        case 'inspect':  await this.handleInspect(msg, manager, document, send); break;
      }
    });

    // - watch for external changes to the .canvas file itself (Obsidian, git pull, MCP)
    // - isSelfSaving suppresses the reload cycle when WE wrote the file.
    // - But an external writer (e.g. MCP server) can write WHILE isSelfSaving is true,
    // - so when that flag is set we compare disk content to lastWrittenJson: if it
    // - differs, an external write slipped through and we must still reload the webview.
    const canvasWatcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);

    // - reload the webview from disk after an external write.
    // - SOFT reload: send canvasLoaded WITHOUT canvasChanged — the latter sets
    // - ready=false which unmounts CanvasView ("Loading canvas…" flash). CanvasView
    // - re-syncs nodes/edges in place from the canvas prop, so an AI add-note just
    // - mounts the one new node (React Flow diffs by id) instead of remounting all.
    const reloadFromDisk = async () => {
      try {
        const canvas = normalizeCanvasToOrigin(wrapNodesInSection(await readCanvas(document.uri.fsPath)));
        document.updateFromDisk(canvas);
        send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
        // - covers the rare race where a pending cross-canvas focus arrived before this
        // - panel was registered in panelsByPath (see the webviewReady canvasLoaded above)
        const wantLabel = this.pendingFocus.get(document.uri.fsPath);
        if (wantLabel) {
          const target = document.canvas.nodes.find(n => n.nodeLabel === wantLabel);
          if (target) send({ type: 'focusNode', id: target.id } satisfies MsgFocusNode);
          else vscode.window.showWarningMessage(`Skena: ${wantLabel} not found in ${path.basename(document.uri.fsPath)}`);
          this.pendingFocus.delete(document.uri.fsPath);
        }
      } catch { /* ignore parse errors during in-progress external edits */ }
    };

    // - debounce: an AI add-note is two writes (canvas_add_node + canvas_add_edge);
    // - coalesce rapid external writes into a single reload to avoid double redraw
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    canvasWatcher.onDidChange(async () => {
      // - skip our own echo by CONTENT, not the isSelfSaving timer. A large-canvas / slow-FS write
      // - can fire its watcher event AFTER the 400ms flag reverted; that used to slip through as an
      // - "external" change and trigger a reload whose (stale) snapshot dropped a just-created
      // - run-output node. Comparing disk to the last bytes we wrote catches late echoes too.
      try {
        const raw = await fs.readFile(document.uri.fsPath, 'utf-8');
        if (recentWrites.includes(raw)) return;   // - our own write (current, or a late-firing earlier one)
      } catch { return; }
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { reloadTimer = null; void reloadFromDisk(); }, 200);
    });

    // - helper: convert an absolute fsPath to the URI the canvas node uses.
    // - MUST return the same form the node's `file` field was stored with:
    // -   vault files  → vault:// URI
    // -   everything else → path.relative() from canvasDir, possibly starting with ../
    // - Never fall back to absolute path — nodes outside the canvas dir are stored
    // - as ../../... relative paths, and fileChanged must match that key exactly.
    const toCanvasUri = (fsPath: string): string => {
      const vaultUri = resolver.resolveFromFsPath(fsPath);
      if (vaultUri) return vaultUri;
      const rel = path.relative(canvasDir, fsPath).replace(/\\/g, '/');
      return rel.startsWith('.') ? rel : `./${rel}`;
    };

    // - watch vault file changes (chokidar, already running)
    const unsubscribe = this.watcher.onFileChanged(fsPath => {
      send({ type: 'fileChanged', uri: toCanvasUri(fsPath) });
    });

    // - onDidSaveTextDocument fires whenever any file is saved in the VS Code editor
    // - this is the primary live-update trigger for "edit file → see canvas update"
    const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
      const uri = toCanvasUri(doc.uri.fsPath);
      console.log(`[Skena] file saved: ${doc.uri.fsPath} → canvas URI: ${uri}`);
      send({ type: 'fileChanged', uri });
    });

    // - file system watcher covers external changes (git pull, Obsidian, other editors)
    const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{md,ipynb,py,yaml,yml}');
    workspaceWatcher.onDidChange(uri => {
      send({ type: 'fileChanged', uri: toCanvasUri(uri.fsPath) });
    });

    // - track the most-recently-focused canvas panel for the skena.addNode command
    SkenaEditorProvider.activePanel = panel;
    // - register this panel by canvas path so the run-ipc relay can find it for agent-run streaming
    SkenaEditorProvider.panelsByPath.set(document.uri.fsPath, panel);
    // - register the host-side agent-run persist fn (single-writer path); closes over the same
    // - self-save suppression + last-written tracking the webview's saveCanvas uses.
    SkenaEditorProvider.agentPersistByPath.set(document.uri.fsPath, {
      panel,
      fn: payload => this.persistAgentRun(payload, panel, document, v => { isSelfSaving = v; }, s => rememberWrite(s)),
    });
    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.active) {
        SkenaEditorProvider.activePanel = webviewPanel;
        // - authoritative "navigated back to this canvas" signal → let the webview
        // - restore chat focus if it had it when the user left (window focus is noisy)
        send({ type: 'panelActivated' });
      }
    });

    // - re-create LLM client when provider/key/model settings change
    const cfgDisposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('skena.ai')) {
        this._llmClient = null;   // - force re-creation on next chat
        // - refresh the chat title's model/provider live on settings change
        const aiCfg = vscode.workspace.getConfiguration('skena.ai');
        send({ type: 'chatModelInfo', model: document.canvas.metadata?.aiModel || aiCfg.get<string>('model') || '', provider: aiCfg.get<string>('provider') ?? '', sessionName: this.sessionNameFor(document) });
      }
      // - keep this canvas's file resolver current when vaults change, so vault:// nodes
      // - added after a vault is configured resolve without reopening the canvas
      if (e.affectsConfiguration('skena.vaults') || e.affectsConfiguration('skena.vaultDirectories')) {
        void getVaults().then(v => resolver.updateVaults(v));
      }
      if (e.affectsConfiguration('skena.jupyter.kernels')) manager.reloadConfig();
    });

    panel.onDidDispose(() => {
      panelDisposed = true;   // - stop any in-flight async work from posting to the dead webview
      if (SkenaEditorProvider.activePanel === panel) {
        SkenaEditorProvider.activePanel = null;
      }
      if (SkenaEditorProvider.panelsByPath.get(document.uri.fsPath) === panel) {
        SkenaEditorProvider.panelsByPath.delete(document.uri.fsPath);
      }
      if (SkenaEditorProvider.agentPersistByPath.get(document.uri.fsPath)?.panel === panel) {
        SkenaEditorProvider.agentPersistByPath.delete(document.uri.fsPath);
      }
      // - kill this canvas's persistent harness process when its panel closes
      this._llmClient?.disposeSession?.(document.uri.fsPath);
      manager.stopPolling();
      canvasWatcher.dispose();
      workspaceWatcher.dispose();
      saveDisposable.dispose();
      cfgDisposable.dispose();
      unsubscribe();
    });

  }

  // CustomEditorProvider save/backup stubs (canvas is auto-saved via messages)
  saveCustomDocument(): Thenable<void> { return Promise.resolve(); }
  saveCustomDocumentAs(): Thenable<void> { return Promise.resolve(); }
  revertCustomDocument(): Thenable<void> { return Promise.resolve(); }
  backupCustomDocument(): Thenable<vscode.CustomDocumentBackup> {
    return Promise.resolve({ id: '', delete: () => {} });
  }

  readonly onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<SkenaDocument>
  >().event;

  // ─── message handlers ────────────────────────────────────────────────────────

  private async handleRequestFile(
    msg: MsgRequestFile,
    panel: vscode.WebviewPanel,
    document: SkenaDocument,
    resolver: FileResolver,
    canvasDir: string,
  ): Promise<void> {
    const send = (m: HostToWebview) => panel.webview.postMessage(m);
    const resolved = resolver.resolve(msg.uri, canvasDir);

    if (!resolved) {
      send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: 'NOT_FOUND' });
      return;
    }

    if (resolved.isNotion) {
      // - Notion: delegate to notion-client (Phase 2+ feature)
      send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: 'NOTION_OFFLINE' });
      return;
    }

    try {
      const stat = await fs.stat(resolved.fsPath);

      let content: string;
      let resourceUri: string | undefined;
      let truncated: boolean | undefined;
      let totalSize: number | undefined;

      if (resolved.fileType === 'image') {
        // - encode image as base64 data URI — works on Remote SSH, web extension,
        // - and avoids localResourceRoots/CSP issues with vscode-resource:// for
        // - inline images embedded inside markdown content
        const ext = path.extname(resolved.fsPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.png':  'image/png',
          '.jpg':  'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif':  'image/gif',
          '.svg':  'image/svg+xml',
          '.webp': 'image/webp',
        };
        const mime = mimeMap[ext] ?? 'application/octet-stream';
        const bytes = await fs.readFile(resolved.fsPath);
        resourceUri = `data:${mime};base64,${bytes.toString('base64')}`;
        content = '';
      } else if (resolved.fileType === 'notebook') {
        // - parse first, then gate on the serialised output size (not raw file size).
        // - raw notebooks embed base64 images that don't grow after parsing,
        // - so checking raw size is overly conservative. 10 MB of parsed output
        // - is a reasonable ceiling before the webview starts struggling.
        const raw    = await fs.readFile(resolved.fsPath, 'utf-8');
        const parsed = JSON.stringify(parseNotebook(raw));
        if (parsed.length > MAX_NOTEBOOK_BYTES) {
          send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: 'TOO_LARGE' });
          return;
        }
        content = parsed;
      } else if (stat.size <= MAX_FILE_FULL_BYTES) {
        // - file fits within the full-render limit — send as-is
        content = await fs.readFile(resolved.fsPath, 'utf-8');
      } else {
        // - file is too large to render fully; send first MAX_FILE_PREVIEW_BYTES
        // - so the user sees a meaningful preview rather than an error
        const fd = await fs.open(resolved.fsPath, 'r');
        try {
          const buf = Buffer.alloc(MAX_FILE_PREVIEW_BYTES);
          const { bytesRead } = await fd.read(buf, 0, MAX_FILE_PREVIEW_BYTES, 0);
          // - decode and trim to the last newline so we don't cut mid-character or mid-word
          let raw = buf.slice(0, bytesRead).toString('utf-8');
          const lastNl = raw.lastIndexOf('\n');
          if (lastNl > 0) raw = raw.slice(0, lastNl + 1);
          content   = raw;
          truncated = true;
          totalSize = stat.size;
        } finally {
          await fd.close();
        }
      }

      // - render markdown to HTML in the extension host (Node.js, off UI thread)
      // - so the webview never has to run ReactMarkdown on large files
      let html: string | undefined;
      if (resolved.fileType === 'markdown' && content) {
        try {
          // - resolve relative image src attrs to vscode-resource:// URIs via
          // - asWebviewUri — pure string transformation, zero I/O, no base64 blobs.
          // - The browser fetches these natively; the IPC message stays compact.
          const mdDir = path.dirname(resolved.fsPath);
          html = await renderMarkdownToHtml(content, (src) => {
            try {
              const imgPath = path.resolve(mdDir, src);
              return panel.webview.asWebviewUri(vscode.Uri.file(imgPath)).toString();
            } catch {
              return undefined; // - leave src unchanged if path can't be resolved
            }
          });
        } catch (e) {
          // - fall back to raw content if rendering fails; webview uses ReactMarkdown
          console.warn(`[Skena] markdown render failed for ${msg.uri}:`, e);
        }
      }

      console.log(`[Skena] handleRequestFile: uri=${msg.uri} fileType=${resolved.fileType} size=${stat.size}${truncated ? ` (truncated)` : ''}${html ? ' (html rendered)' : ''}`);
      send({
        type: 'fileContent',
        requestId: msg.requestId,
        uri: msg.uri,
        fileType: resolved.fileType,
        content,
        resourceUri,
        truncated,
        totalSize,
        html,
      });
    } catch (e) {
      console.error(`[Skena] handleRequestFile error for ${msg.uri}:`, e);
      send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: String(e) });
    }
  }

  private async handleSaveCanvas(
    msg: MsgSaveCanvas,
    document: SkenaDocument,
    setSelfSaving: (v: boolean) => void,
    setLastWrittenJson: (s: string) => void,
  ): Promise<void> {
    try {
      setSelfSaving(true);
      // - the webview snapshot is nodes/edges only; it does NOT own canvas metadata (aiModel is
      // - set host-side via pickModel). Keep the host's metadata authoritative, else this
      // - auto-save clobbers metadata.aiModel back to null and the per-canvas model is lost on reopen.
      // - Also keep each code node's outputNodeId: a stale webview snapshot (reverted by a reload) can
      // - arrive with it cleared, which would unlink the output cell and make the NEXT run create a
      // - duplicate. If the host still has the link AND the output cell is present, preserve it.
      const hostById = new Map(document.canvas.nodes.map(n => [n.id, n]));
      const msgIds   = new Set(msg.canvas.nodes.map(n => n.id));
      const mergedNodes = msg.canvas.nodes.map(n => {
        if (n.type !== 'code' || (n as CodeNode).outputNodeId) return n;
        const hostOid = (hostById.get(n.id) as CodeNode | undefined)?.outputNodeId;
        return hostOid && msgIds.has(hostOid) ? { ...(n as CodeNode), outputNodeId: hostOid } : n;
      });
      const canvasToWrite = { ...msg.canvas, nodes: mergedNodes, metadata: document.canvas.metadata };
      const json = JSON.stringify(canvasToWrite, null, 2);
      setLastWrittenJson(json);
      await writeCanvas(document.uri.fsPath, canvasToWrite);
      document.updateFromDisk(canvasToWrite);
    } catch (e) {
      vscode.window.showErrorMessage(`Skena: failed to save canvas: ${e}`);
    } finally {
      // - clear flag after watcher debounce settles (chokidar awaitWriteFinish ~200ms + margin)
      setTimeout(() => setSelfSaving(false), 400);
    }
  }

  private async handleOpenFile(
    msg: MsgOpenFile,
    resolver: FileResolver,
    canvasDir: string,
  ): Promise<void> {
    // - web URLs → open in VS Code's built-in browser (or system browser)
    if (msg.uri.startsWith('http://') || msg.uri.startsWith('https://')) {
      await vscode.env.openExternal(vscode.Uri.parse(msg.uri));
      return;
    }

    // - cross-canvas node reference: <path>.canvas#<Label> → open that canvas and focus the node
    const ref = parseNodeRef(msg.uri);
    if (ref) {
      const resolvedPath = this.resolveCanvasRefPath(ref.canvas, canvasDir, resolver);
      if (!resolvedPath) {
        vscode.window.showWarningMessage(`Skena: linked canvas not found — ${ref.canvas}`);
        return;
      }
      this.pendingFocus.set(resolvedPath, ref.label);
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(resolvedPath), SkenaEditorProvider.viewType);
      // - covers the already-open-panel case; a freshly-opened panel is handled by the
      // - canvasLoaded hook in resolveCustomEditor instead, since canvasLoaded hasn't fired yet
      await this.tryFocusPending(resolvedPath);
      return;
    }

    // - optional GitHub-style line fragment: file.py#L37 or file.py#37 → open at that line
    let target = msg.uri;
    let line: number | undefined;
    const frag = target.match(/#L?(\d+)$/);
    if (frag) { line = parseInt(frag[1], 10); target = target.slice(0, frag.index); }

    const resolved = resolver.resolve(target, canvasDir);
    if (!resolved || resolved.isNotion) return;

    // - clean, actionable message for a broken link instead of VS Code's raw error dump
    if (!resolver.exists(resolved.fsPath)) {
      vscode.window.showWarningMessage(`Skena: linked file not found — ${target}`);
      return;
    }

    const fsUri = vscode.Uri.file(resolved.fsPath);
    const ext   = path.extname(resolved.fsPath).toLowerCase();

    // - Enter        → open beside the canvas (split view, preview tab)
    // - Ctrl+Enter   → open in the same column as the canvas (overlay tab, like Settings)
    //   The canvas tab remains accessible; closing the file returns to the canvas.
    const viewColumn = msg.modal ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;

    try {
      if (ext === '.ipynb') {
        // - open in Jupyter notebook editor (not raw text)
        const nb = await vscode.workspace.openNotebookDocument(fsUri);
        await vscode.window.showNotebookDocument(nb, {
          viewColumn,
          preserveFocus: false,
          preview: !msg.modal,
        });
      } else if (ext === '.canvas') {
        // - open in Skena canvas editor (not raw JSON)
        await vscode.commands.executeCommand(
          'vscode.openWith',
          fsUri,
          SkenaEditorProvider.viewType,
          { viewColumn, preview: !msg.modal },
        );
      } else {
        // - .md and all other text files → open in text editor (edit mode)
        const doc = await vscode.workspace.openTextDocument(resolved.fsPath);
        // - if a #L<n> line was given, place the cursor there and reveal it
        const selection = line ? new vscode.Range(line - 1, 0, line - 1, 0) : undefined;
        await vscode.window.showTextDocument(doc, { viewColumn, preview: !msg.modal, selection });
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Skena: cannot open file: ${e}`);
    }
  }

  // - NoderefNode.canvas is documented workspace-relative (unlike PortalNode.canvas, which is
  // - relative to the referencing .canvas). Try the shared resolver first — it covers vault://,
  // - absolute, and canvasDir-relative (the common case, vault at the workspace root) — then
  // - fall back to each workspace folder root for a ref authored deeper in the tree.
  private resolveCanvasRefPath(refCanvas: string, canvasDir: string, resolver: FileResolver): string | null {
    const direct = resolver.resolve(refCanvas, canvasDir);
    if (direct && !direct.isNotion && resolver.exists(direct.fsPath)) return direct.fsPath;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const candidate = path.resolve(folder.uri.fsPath, refCanvas);
      if (resolver.exists(candidate)) return candidate;
    }
    return null;
  }

  // - if the target canvas already has a live panel, resolve its pending label→node id and
  // - focus it now. A freshly-opened panel hasn't sent canvasLoaded yet at this point — that
  // - path is covered by the canvasLoaded hook in resolveCustomEditor instead.
  private async tryFocusPending(fsPath: string): Promise<void> {
    const label = this.pendingFocus.get(fsPath);
    if (!label) return;
    const panel = SkenaEditorProvider.panelsByPath.get(fsPath);
    if (!panel) return;
    try {
      const canvas = await readCanvas(fsPath);
      const node = canvas.nodes.find(n => n.nodeLabel === label);
      if (node) {
        panel.webview.postMessage({ type: 'focusNode', id: node.id } satisfies MsgFocusNode);
      } else {
        vscode.window.showWarningMessage(`Skena: ${label} not found in ${path.basename(fsPath)}`);
      }
    } finally {
      this.pendingFocus.delete(fsPath);
    }
  }

  // - the CC session --name for this canvas (matches what the harness spawns), shown in the chat title
  private sessionNameFor(document: { uri: vscode.Uri }): string {
    const wsDir = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    return canvasSessionName(wsDir, document.uri.fsPath);
  }

  private handleDropFiles(
    rawUris: string[],
    position: { x: number; y: number },
    canvasDir: string,
    resolver: FileResolver,
    send: (m: HostToWebview) => void,
    connectTo?: string,
  ): void {
    const nodes: CanvasNode[] = [];

    rawUris.forEach((rawUri, i) => {
      let fsPath: string;
      try {
        // - handles file://, vscode-remote://ssh-remote+host/path, vscode-resource://
        fsPath = vscode.Uri.parse(rawUri).fsPath;
      } catch {
        return;
      }
      if (!fsPath) return;

      // - try to express as vault:// URI first
      const resolved = resolver.resolveFromFsPath(fsPath);

      // - stagger multiple drops slightly so nodes don't stack exactly
      const node: FileNode = {
        id:     `node-${Date.now()}-${i}`,
        type:   'file',
        file:   resolved ?? path.relative(canvasDir, fsPath).replace(/\\/g, '/'),
        x:      Math.round(position.x + i * 24),
        y:      Math.round(position.y + i * 24),
        width:  NODE_SIZE.file.w,
        height: NODE_SIZE.file.h,
      };
      nodes.push(node);
    });

    if (nodes.length > 0) {
      send({ type: 'nodesFromDrop', nodes, connectTo });
    }
  }

  async handleAddNodeRequest(
    msg:       MsgAddNodeRequest,
    canvasDir: string,
    resolver:  FileResolver,
    send:      (m: HostToWebview) => void,
  ): Promise<void> {
    // - sentinel values for special "create" items
    const NEW_TEXT_NOTE = '__skena_new_text_note__';
    const NEW_URL       = '__skena_new_url__';

    // - vault entries
    const vaultEntries = this.indexer.all();

    // - workspace files (limit 300, exclude noise)
    const wsUris = await vscode.workspace.findFiles(
      '**/*.{md,ipynb,py,yaml,yml,canvas}',
      '{**/node_modules/**,**/.git/**,**/__pycache__/**,**/.venv/**}',
      300,
    );

    // - build a set of vault fsPath for deduplication
    const vaultPaths = new Set(vaultEntries.map(e => e.fsPath).filter(Boolean));

    // - vaultName added so onDidChangeValue can scope results by vault prefix
    type Item = vscode.QuickPickItem & { canvasUri: string; vaultName?: string };

    // - extract short vault name from vault:// URI (e.g. 'kb' from 'vault://kb/...')
    const vaultOf = (uri: string): string | undefined => {
      const m = uri.match(/^vault:\/\/([^/]+)\//);
      return m ? m[1].toLowerCase() : undefined;
    };

    // - special items: create an inline text node or a URL/link node
    const newTextItem: Item = {
      label:       '$(edit)  New text note',
      description: 'Inline markdown note (no file)',
      canvasUri:   NEW_TEXT_NOTE,
    };
    const newUrlItem: Item = {
      label:       '$(link)  New URL',
      description: 'External link node (http/https)',
      canvasUri:   NEW_URL,
    };

    const vaultItems: Item[] = vaultEntries.map(e => ({
      label:       e.title,
      description: e.type ?? '',
      detail:      e.tags.length ? e.tags.join('  ·  ') : undefined,
      canvasUri:   e.uri,
      vaultName:   vaultOf(e.uri),
    }));

    // - filenames that are never useful in the picker
    const SKIP_FILENAMES = new Set(['__init__.py']);

    const wsItems: Item[] = wsUris
      .filter(u => !vaultPaths.has(u.fsPath) && !SKIP_FILENAMES.has(path.basename(u.fsPath)))
      .map(u => ({
        label:       path.basename(u.fsPath),
        description: vscode.workspace.asRelativePath(u.fsPath),
        canvasUri:   (() => {
          const rel = path.relative(canvasDir, u.fsPath).replace(/\\/g, '/');
          return rel.startsWith('.') ? rel : `./${rel}`;
        })(),
      }));

    // - full (unfiltered) list used as default and to restore after vault scope exit
    const allItems: Item[] = [
      { label: 'Create', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
      newTextItem,
      newUrlItem,
      ...(vaultItems.length ? [
        { label: 'Vault', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
        ...vaultItems,
      ] : []),
      ...(wsItems.length ? [
        { label: 'Workspace', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
        ...wsItems,
      ] : []),
    ];

    // - known vault names (to validate prefix before entering vault scope)
    const knownVaults = new Set(vaultItems.map(i => i.vaultName).filter(Boolean) as string[]);

    // - parse "vaultName:rest" prefix (same logic as CanvasSearch)
    const parsePrefix = (raw: string): { vault: string | null; text: string } => {
      const colonIdx = raw.indexOf(':');
      if (colonIdx > 0) {
        const vaultId = raw.slice(0, colonIdx).trim().toLowerCase();
        const text    = raw.slice(colonIdx + 1).trimStart();
        if (vaultId && !/\s/.test(vaultId) && knownVaults.has(vaultId)) {
          return { vault: vaultId, text };
        }
      }
      return { vault: null, text: raw };
    };

    // - build vault-scoped item list for a given vault id
    const scopedItems = (vault: string): Item[] => [
      { label: 'Create', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
      newTextItem,
      newUrlItem,
      { label: `Vault: ${vault}`, kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
      ...vaultItems.filter(i => i.vaultName === vault),
    ];

    const defaultPlaceholder = knownVaults.size
      ? `Add node — type ${[...knownVaults][0]}:query to scope by vault, or search all…`
      : 'Add node — search vault / workspace, or create text note…';

    // - run the picker via createQuickPick so we can intercept value changes
    const picked = await new Promise<Item | undefined>(resolve => {
      const qp = vscode.window.createQuickPick<Item>();
      qp.placeholder        = defaultPlaceholder;
      qp.matchOnDescription = true;
      qp.matchOnDetail      = true;
      qp.items              = allItems;

      let activeVault: string | null = null; // - currently scoped vault (null = no scope)
      let resolved    = false;

      // - single resolve point — guards against onDidChangeSelection + onDidHide both firing
      const done = (item: Item | undefined) => {
        if (resolved) return;
        resolved = true;
        qp.dispose();
        resolve(item);
      };

      const applyVaultScope = (vault: string, text: string) => {
        activeVault = vault;
        qp.title    = `Vault: ${vault}`;

        const tl = text.toLowerCase();
        const filtered: Item[] = vaultItems
          .filter(i =>
            i.vaultName === vault && (
              !tl ||
              i.label.toLowerCase().includes(tl) ||
              (i.description ?? '').toLowerCase().includes(tl) ||
              (i.detail     ?? '').toLowerCase().includes(tl)
            )
          )
          .map(i => ({ ...i, alwaysShow: true as const }));

        qp.items = [
          { ...newTextItem, alwaysShow: true as const },
          { ...newUrlItem,  alwaysShow: true as const },
          { label: `Vault: ${vault}`, kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
          ...filtered,
        ];
      };

      qp.onDidChangeValue(raw => {
        const { vault, text } = parsePrefix(raw);

        if (vault !== null) {
          applyVaultScope(vault, text);
        } else if (activeVault !== null) {
          // - vault prefix removed (user backspaced past ":") → exit scope
          activeVault    = null;
          qp.title       = '';
          qp.placeholder = defaultPlaceholder;
          qp.items       = allItems;
        }
        // - no vault prefix and no active scope: VS Code handles normal fuzzy matching
      });

      // - onDidChangeSelection fires on actual item pick (click or Enter on focused item);
      // - this is more reliable than onDidAccept + activeItems[0] which can be empty when
      // - alwaysShow bypasses VS Code's fuzzy scorer
      qp.onDidChangeSelection(items => done(items[0] as Item | undefined));
      qp.onDidHide(()               => done(undefined));

      qp.show();
    });

    if (!picked || !picked.canvasUri) return; // - cancelled or separator clicked

    const nodeId = `node-${Date.now()}`;
    const x      = Math.round(msg.position.x);
    const y      = Math.round(msg.position.y);
    // - directional-add passes a preferred size; fall back to the historical default
    const w      = msg.width  ?? NODE_SIZE.text.w;
    const h      = msg.height ?? NODE_SIZE.text.h;

    let newNode: FileNode | TextNode | LinkNode | PortalNode;
    let autoEdit = false;

    if (picked.canvasUri === NEW_TEXT_NOTE) {
      // - inline text node — opens Monaco immediately so the user can start typing
      newNode = { id: nodeId, type: 'text', text: '', x, y, width: w, height: h };
      autoEdit = true;
    } else if (picked.canvasUri === NEW_URL) {
      // - prompt for URL, then create a link node
      const url = await vscode.window.showInputBox({
        prompt:            'Enter URL',
        placeHolder:       'https://example.com',
        validateInput: v => {
          if (!v.trim()) return 'URL cannot be empty';
          try { new URL(v.trim()); return undefined; } catch { return 'Enter a valid URL (https://…)'; }
        },
      });
      if (!url) return; // - user cancelled the input box
      newNode = { id: nodeId, type: 'link', url: url.trim(), x, y, width: NODE_SIZE.link.w, height: NODE_SIZE.link.h };
    } else if (picked.canvasUri.endsWith('.canvas')) {
      // - .canvas file → portal node (circle shape, opens linked canvas on click)
      newNode = { id: nodeId, type: 'portal', canvas: picked.canvasUri, x, y, width: NODE_SIZE.portal.w, height: NODE_SIZE.portal.h };
    } else {
      // - a vault file (md/py/…) → size it as a FILE node, not the big directional-add default:
      //   the passed w/h is NEW_NODE (meant for a fresh text node); files want NODE_SIZE.file.
      newNode = { id: nodeId, type: 'file', file: picked.canvasUri, x, y, width: NODE_SIZE.file.w, height: NODE_SIZE.file.h };
    }

    let edge: CanvasEdge | undefined;
    if (msg.fromNodeId && msg.fromSide && msg.toSide) {
      edge = {
        id:       `edge-${Date.now()}`,
        fromNode: msg.fromNodeId,
        fromSide: msg.fromSide,
        toNode:   nodeId,
        toSide:   msg.toSide,
        toEnd:    'arrow',
      };
    }

    send({ type: 'addNodeResult', node: newNode, edge, autoEdit });
  }

  private async handleMoveToSubCanvas(
    msg:       MsgMoveToSubCanvas,
    canvasDir: string,
    send:      (m: HostToWebview) => void,
  ): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt:        'New canvas name',
      placeHolder:   'sub-canvas',
      validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) return; // - user cancelled

    // - auto-append .canvas if the user didn't include it
    const filename = name.trim().endsWith('.canvas') ? name.trim() : `${name.trim()}.canvas`;

    // - normalize node positions so they start near (40, 40) in the new canvas
    const minX = Math.min(...msg.nodes.map(n => n.x));
    const minY = Math.min(...msg.nodes.map(n => n.y));
    const normalized = msg.nodes.map(n => ({ ...n, x: n.x - minX + 40, y: n.y - minY + 40 }));

    const newCanvasPath = path.join(canvasDir, filename);
    await writeCanvas(newCanvasPath, { nodes: normalized, edges: msg.edges });

    const relPath = `./${filename}`;
    const nodeId  = `node-${Date.now()}`;
    const portalNode: import('../shared/types').PortalNode = {
      id:     nodeId,
      type:   'portal',
      canvas: relPath,
      x:      msg.position.x,
      y:      msg.position.y,
      width:  NODE_SIZE.portal.w,
      height: NODE_SIZE.portal.h,
    };

    send({
      type:         'subCanvasCreated',
      portalNode,
      movedNodeIds: msg.nodes.map(n => n.id),
    });
  }

  // ─── Jupyter kernel handlers ─────────────────────────────────────────────────

  /**
   * Host-side single-writer persist for an AGENT run (MCP canvas_run_cell), delegated over the
   * run-ipc relay when a panel is open. Mirrors runOneCell's applyAndPersist: mutate the
   * authoritative document.canvas, write with self-save suppression (no reload), and push a
   * targeted runOutput to the webview — so the MCP's external writes no longer race the webview's
   * debounced save (which reset outputNodeId to a disk state and duplicated the output node).
   */
  private async persistAgentRun(
    payload:        AgentRunPersist,
    panel:          vscode.WebviewPanel,
    document:       SkenaDocument,
    setSelfSaving:  (v: boolean) => void,
    setLastWritten: (s: string) => void,
  ): Promise<AgentRunPersistResult> {
    try {
      const c  = document.canvas;
      const cn = c.nodes.find(n => n.id === payload.cellNodeId && n.type === 'code') as CodeNode | undefined;
      if (!cn) return { handled: true };   // - cell deleted mid-run; nothing to write, but we DID handle it

      // - resolve the CURRENT panel on every send (a run can outlive close+reopen), like runOneCell
      const send = (m: HostToWebview) => {
        const p = SkenaEditorProvider.panelsByPath.get(document.uri.fsPath) ?? panel;
        try { p.webview.postMessage(m); } catch { /* panel disposed */ }
      };

      const kn = c.nodes.find(n => n.id === payload.kernelNodeId && n.type === 'kernel') as KernelNode | undefined;
      if (kn && payload.kernelId !== kn.kernelId) kn.kernelId = payload.kernelId;   // - reuse this kernel next run

      const persist = async () => {
        setSelfSaving(true);
        const json = JSON.stringify(c, null, 2);
        setLastWritten(json);
        await writeCanvas(document.uri.fsPath, c);
        setTimeout(() => setSelfSaving(false), 400);
      };

      if (payload.phase === 'start') {
        cn.lastStatus = 'running';
        // - do NOT set cn.outputNodeId yet — only commit it once there is output (matches applyAndPersist)
        const outId = cn.outputNodeId ?? `ai-${Date.now().toString(36)}`;
        await persist();
        send({ type: 'runOutput', codeNodeId: cn.id, lastStatus: 'running', kernelNodeId: payload.kernelNodeId, kernelId: payload.kernelId, source: 'host' });
        return { handled: true, outputNodeId: outId };
      }

      cn.lastStatus = payload.status ?? 'ok';
      cn.lastRun    = Date.now();
      let outputNode: CellNode | undefined;
      let edge:       CanvasEdge | undefined;
      if (payload.output) {
        const outId    = payload.outputNodeId ?? cn.outputNodeId ?? `ai-${Date.now().toString(36)}`;
        const existing = c.nodes.find(n => n.id === outId && n.type === 'cell') as CellNode | undefined;
        if (existing) {
          existing.format  = payload.output.format;
          existing.content = payload.output.content;
          outputNode = existing;
          // - match by node pair so an old `edge-out-` edge on a pre-fix canvas isn't duplicated
          edge = c.edges.find(e => e.fromNode === cn.id && e.toNode === outId);
          if (!edge) {
            edge = { id: `e-${outId}`, fromNode: cn.id, fromSide: 'right', toNode: outId, toSide: 'left', toEnd: 'arrow' };
            c.edges.push(edge);
          }
        } else {
          const cellBase: CellNode = {
            id: outId, type: 'cell',
            x: cn.x + cn.width + 140, y: Math.round(cn.y + (cn.height - 320) / 2), width: 480, height: 320,
            format: payload.output.format, content: payload.output.content, createdBy: 'ai',
          };
          outputNode = assignLabel(cellBase, c.nodes) as CellNode;
          c.nodes.push(outputNode);
          cn.outputNodeId = outId;
          edge = { id: `e-${outId}`, fromNode: cn.id, fromSide: 'right', toNode: outId, toSide: 'left', toEnd: 'arrow' };
          c.edges.push(edge);
        }
      }
      await persist();
      send({
        type: 'runOutput', codeNodeId: cn.id, lastStatus: payload.status ?? 'ok',
        kernelNodeId: payload.kernelNodeId, kernelId: payload.kernelId, source: 'host',
        ...(outputNode ? { outputNode } : {}),
        ...(edge ? { edge } : {}),
      });
      return { handled: true };
    } catch {
      return { handled: false };   // - persist failed; MCP falls back to its own writeCanvas
    }
  }

  /**
   * Execute a code node on its bound kernel, route the result into a single
   * reused output cell node, and stream run status to the webview.
   *
   * Persistence follows the AI add-note path: mutate document.canvas in place,
   * then writeCanvas (WITHOUT the isSelfSaving flag) so the file-watcher soft
   * reload re-syncs the webview. Run status (spinner + animated edge) is pushed
   * separately as transient UI via runStatus messages.
   */
  private async runOneCell(
    msg:            MsgRunCell,
    manager:        KernelManager,
    panel:          vscode.WebviewPanel,
    document:       SkenaDocument,
    setSelfSaving:  (v: boolean) => void,
    setLastWritten: (s: string) => void,
  ): Promise<'ok' | 'error'> {
    // - the run can outlive its panel (user closes the canvas mid-run); posting to a
    // - disposed webview throws, so swallow it — the output is still persisted to disk.
    // - resolve the CURRENT panel for this canvas on every send, so a run that outlives a
    // - close+reopen streams its live output/status to the NEW panel, not the disposed original.
    const send   = (m: HostToWebview) => {
      const p = SkenaEditorProvider.panelsByPath.get(document.uri.fsPath) ?? panel;
      try { p.webview.postMessage(m); } catch { /* panel disposed */ }
    };
    const canvas = document.canvas;

    const codeNode = canvas.nodes.find(
      n => n.id === msg.cellNodeId && n.type === 'code',
    ) as CodeNode | undefined;
    if (!codeNode) return 'error';

    // - bound kernel: the nearest kernel reachable through edges (BFS), so a chain
    // - of cells (cell2 → cell1 → kernel) shares one kernel.
    const nodeById = new Map(canvas.nodes.map(n => [n.id, n]));
    const boundKernelNodeId = resolveBoundKernel(codeNode.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
    const kernelNode = boundKernelNodeId ? nodeById.get(boundKernelNodeId) as KernelNode | undefined : undefined;
    if (!kernelNode) {
      send({ type: 'runStatus', cellNodeId: codeNode.id, kernelNodeId: null, state: 'error', error: 'no kernel bound' });
      return 'error';
    }

    const server = manager.serverByName(kernelNode.server);
    if (!server) {
      send({ type: 'runStatus', cellNodeId: codeNode.id, kernelNodeId: kernelNode.id, state: 'error', error: 'unknown server' });
      return 'error';
    }

    send({ type: 'runStatus', cellNodeId: codeNode.id, kernelNodeId: kernelNode.id, state: 'running' });

    const fail = (error: string) =>
      send({ type: 'runStatus', cellNodeId: codeNode.id, kernelNodeId: kernelNode.id, state: 'error', error });

    // - persist a 'running' marker to disk (self-save suppressed, no reload) so reopening the
    // - canvas — or the kernel finishing after this panel closed — shows the cell in-progress
    // - instead of its previous status. The end-of-run write overwrites it with ok/error.
    try {
      const c = document.canvas;
      const cn = c.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
      if (cn) {
        cn.code = msg.code;
        cn.lastStatus = 'running';
        setSelfSaving(true);
        setLastWritten(JSON.stringify(c, null, 2));
        await writeCanvas(document.uri.fsPath, c);
        setTimeout(() => setSelfSaving(false), 400);
      }
    } catch { /* - best-effort marker */ }

    // - apply the run's mutations to the CURRENT document.canvas, persist WITHOUT triggering
    // - the watcher reload (self-save suppression, like handleSaveCanvas), and return the
    // - output node/edge so the caller can push a TARGETED runOutput update to the webview.
    // - This avoids a full canvas reload (which re-syncs every node → focus jump + shift).
    // - The run awaits for seconds; a debounced saveCanvas can swap document._canvas
    // - meanwhile, so we re-resolve nodes by id here rather than writing a captured object.
    const applyAndPersist = async (
      status: 'ok' | 'error',
      output: { format: 'markdown' | 'image' | 'html' | 'plotly'; content: string } | null,
      presetId?: string,
    ): Promise<{ outputNode?: CellNode; edge?: CanvasEdge }> => {
      const c  = document.canvas;
      const cn = c.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
      if (!cn) return {};                         // - cell deleted mid-run
      cn.code       = msg.code;                   // - persist the code that actually ran (edits are debounced)
      cn.lastStatus = status;
      cn.lastRun    = Date.now();
      const kn = c.nodes.find(n => n.id === kernelNode.id && n.type === 'kernel') as KernelNode | undefined;
      if (kn && kernelId !== kn.kernelId) kn.kernelId = kernelId;   // - reuse this kernel next run
      let outputNode: CellNode | undefined;
      let edge:       CanvasEdge | undefined;
      if (output) {
        const existing = cn.outputNodeId
          ? c.nodes.find(n => n.id === cn.outputNodeId && n.type === 'cell') as CellNode | undefined
          : undefined;
        if (existing) {
          // - content only; keep the node WHERE IT IS (the user may have dragged it — don't snap it)
          existing.format  = output.format;
          existing.content = output.content;
          outputNode = existing;
          // - ensure the connecting edge exists (a stale reload may have dropped it) and RETURN it so
          //   the completion runOutput reconnects the output node
          const edgeId = `e-${existing.id}`;
          edge = c.edges.find(e => e.id === edgeId);
          if (!edge) {
            edge = { id: edgeId, fromNode: cn.id, fromSide: 'right', toNode: existing.id, toSide: 'left', toEnd: 'arrow' };
            c.edges.push(edge);
          }
        } else {
          const id = presetId ?? `ai-${Date.now().toString(36)}`;
          const cellBase: CellNode = {
            id, type: 'cell',
            x: cn.x + cn.width + 140, y: Math.round(cn.y + (cn.height - 320) / 2), width: 480, height: 320,
            format: output.format, content: output.content, createdBy: 'ai',
          };
          outputNode = assignLabel(cellBase, c.nodes) as CellNode;
          c.nodes.push(outputNode);
          edge = { id: `e-${id}`, fromNode: cn.id, fromSide: 'right', toNode: id, toSide: 'left', toEnd: 'arrow' };
          c.edges.push(edge);
          cn.outputNodeId = id;
        }
      }
      setSelfSaving(true);
      const json = JSON.stringify(c, null, 2);
      setLastWritten(json);
      await writeCanvas(document.uri.fsPath, c);
      setTimeout(() => setSelfSaving(false), 400);
      return { outputNode, edge };
    };

    // - relaunch the SAME environment on a restart via the node's kernelspec. Older kernel nodes
    //   predate `spec`; recover it once by matching the stored displayName against the server's specs
    //   and heal the node so it persists (else a shutdown+rerun falls back to plain python3).
    let spec = kernelNode.spec;
    if (!spec && !kernelNode.kernelId && kernelNode.displayName) {
      try {
        const specs = await listKernelSpecs(server);
        spec = specs.find(s => s.displayName === kernelNode.displayName || s.name === kernelNode.displayName)?.name;
        if (spec) kernelNode.spec = spec;
      } catch { /* - specs unavailable; ensureKernel falls back to python3 */ }
    }
    let kernelId: string;
    try {
      kernelId = await manager.ensureKernel(server, kernelNode.kernelId, spec);
    } catch (e) {
      fail(`kernel start failed: ${e instanceof Error ? e.message : String(e)}`);
      return 'error';
    }

    const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };

    // - live output: stream partial results to the webview (UI-only, no disk write) so tqdm bars
    // - and long prints animate. The output node id is generated once here and reused by the final
    // - applyAndPersist so the persisted node matches what the webview already shows.
    let liveOutputId: string | undefined;
    let latest: CollectedOutput | null = null;
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    // - once the run reports its final status, no delta may fire again. clearTimeout can't cancel
    // - a 120ms timer that has ALREADY fired (its callback is queued); such a stray flush could
    // - otherwise send a 'running' after the final 'ok' and leave the cell stuck showing running.
    let finished = false;
    let livePersisted = false;   // - output node written to disk once so it survives a close+reopen mid-run
    const flushDelta = () => {
      deltaTimer = null;
      if (finished || !latest) return;
      if (!hasVisibleOutput(latest)) return;   // - skip style/script-only + whitespace: no empty node
      const cn = document.canvas.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
      if (!cn) return;
      // - reuse this cell's existing output node on a re-run so the live node updates it in place
      // - (a fresh id would duplicate the persisted output cell); only mint a new id on first run
      if (!liveOutputId) liveOutputId = cn.outputNodeId ?? `ai-${Date.now().toString(36)}`;
      const { format, content } = renderOutput(latest);
      const outputNode: CellNode = {
        id: liveOutputId, type: 'cell',
        x: cn.x + cn.width + 140, y: Math.round(cn.y + (cn.height - 320) / 2), width: 480, height: 320,
        format, content, createdBy: 'ai',
      };
      const edge: CanvasEdge = { id: `e-${liveOutputId}`, fromNode: cn.id, fromSide: 'right', toNode: liveOutputId, toSide: 'left', toEnd: 'arrow' };
      try {
        send({ type: 'runOutput', codeNodeId: codeNode.id, lastStatus: 'running', kernelNodeId: kernelNode.id, kernelId, outputNode, edge });
      } catch { /* - webview disposed mid-run; disk write at completion still happens */ }
      // - persist the output node to disk ONCE (first creation) so a close+reopen mid-run keeps it —
      // - the live frames are otherwise UI-only. Re-runs already have it on disk, so this is skipped.
      if (!livePersisted) {
        livePersisted = true;
        const c = document.canvas;
        const cnDisk = c.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
        if (cnDisk && !cnDisk.outputNodeId) {
          if (!c.nodes.some(n => n.id === outputNode.id)) c.nodes.push(assignLabel(outputNode, c.nodes) as CellNode);
          if (!c.edges.some(e => e.id === edge.id)) c.edges.push(edge);
          cnDisk.outputNodeId = outputNode.id;
          setSelfSaving(true);
          setLastWritten(JSON.stringify(c, null, 2));
          void writeCanvas(document.uri.fsPath, c).finally(() => setTimeout(() => setSelfSaving(false), 400));
        }
      }
    };
    const onDelta = (partial: CollectedOutput) => {
      latest = partial;
      if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 120);   // - coalesce high-frequency frames
    };

    let out: CollectedOutput;
    try {
      out = await manager.run(server, kernelId, msg.code, ids, onDelta);
    } catch (e) {
      finished = true;
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
      try {
        // - if partial output was streamed before the failure, persist it (status error) under the
        // - same id so the live node reconciles to disk instead of being orphaned in the webview.
        const snap = latest as CollectedOutput | null;   // - CFA narrows the closure-assigned `latest` to null; widen it
        const streamed = snap && hasVisibleOutput(snap) ? renderOutput(snap) : null;
        const { outputNode, edge } = await applyAndPersist('error', streamed, liveOutputId);
        send({ type: 'runOutput', codeNodeId: codeNode.id, lastStatus: 'error', kernelNodeId: kernelNode.id, kernelId, outputNode, edge });
      } catch { /* non-fatal */ }
      fail(`execution failed: ${e instanceof Error ? e.message : String(e)}`);
      return 'error';
    }
    finished = true;
    if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }

    // - collapse ALL outputs (stream + every rich mime, in order) into one cell payload
    const { format, content } = renderOutput(out);

    // - only write an output node when the run produced something VISIBLE (style/script-only
    // - HTML — the ipywidgets/pandas CSS injection — and whitespace streams do not count)
    const hasOutput = hasVisibleOutput(out);
    const status: 'ok' | 'error' = out.status === 'error' ? 'error' : 'ok';
    try {
      const { outputNode, edge } = await applyAndPersist(status, hasOutput ? { format, content } : null, liveOutputId);
      // - targeted update: webview mirrors the output node without a full reload
      send({ type: 'runOutput', codeNodeId: codeNode.id, lastStatus: status, kernelNodeId: kernelNode.id, kernelId, outputNode, edge });
    } catch (e) {
      vscode.window.showErrorMessage(`Skena: failed to save run output: ${e}`);
    }

    // - stop the running-edge animation (runStatus drives it)
    send({ type: 'runStatus', cellNodeId: codeNode.id, kernelNodeId: kernelNode.id, state: status, error: out.error });
    return status;
  }

  /**
   * Run a cell WITH its upstream: before running the requested cell, run each upstream cell
   * (closer to the kernel) whose run-flag is clear (never run / errored / edited-since), in
   * dependency order. Already-run (lastStatus 'ok') cells are skipped. Stops the chain if any
   * upstream cell errors. Reuses runOneCell verbatim per cell (all its live-output/race logic).
   */
  private async handleRunCell(
    msg:            MsgRunCell,
    manager:        KernelManager,
    panel:          vscode.WebviewPanel,
    document:       SkenaDocument,
    setSelfSaving:  (v: boolean) => void,
    setLastWritten: (s: string) => void,
  ): Promise<void> {
    const canvas   = document.canvas;
    const typeOf   = (id: string) => canvas.nodes.find(n => n.id === id)?.type;
    const upstream = resolveUpstreamChain(
      msg.cellNodeId,
      canvas.edges,
      id => typeOf(id) === 'kernel',
      id => typeOf(id) === 'code',
    );
    // - run upstream cells that need it (clear flag), in order; stop if one errors
    for (const upId of upstream) {
      const up = canvas.nodes.find(n => n.id === upId && n.type === 'code') as CodeNode | undefined;
      if (!up || up.lastStatus === 'ok') continue;   // - already run (and unchanged) → skip
      const st = await this.runOneCell(
        { type: 'runCell', cellNodeId: up.id, code: up.code ?? '' },
        manager, panel, document, setSelfSaving, setLastWritten,
      );
      if (st === 'error') return;   // - a failed upstream cell aborts the chain (don't run downstream)
    }
    // - finally run the requested cell (always) with the code the user is running
    await this.runOneCell(msg, manager, panel, document, setSelfSaving, setLastWritten);
  }

  /**
   * Kernel tab-completion (Ctrl+Space in a code cell). Resolves the cell's bound kernel
   * and asks it to complete the LIVE editor code at the cursor; returns matches (or empty).
   */
  private async handleComplete(
    msg:      { reqId: string; cellNodeId: string; code: string; cursorPos: number },
    manager:  KernelManager,
    document: SkenaDocument,
    send:     (m: HostToWebview) => void,
  ): Promise<void> {
    const empty = () => send({ type: 'completeResult', reqId: msg.reqId, matches: [], cursorStart: msg.cursorPos, cursorEnd: msg.cursorPos });
    const canvas = document.canvas;
    const codeNode = canvas.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code');
    if (!codeNode) return empty();
    const nodeById = new Map(canvas.nodes.map(n => [n.id, n]));
    const kid = resolveBoundKernel(codeNode.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
    const kernelNode = kid ? nodeById.get(kid) as KernelNode | undefined : undefined;
    const server = kernelNode ? manager.serverByName(kernelNode.server) : undefined;
    if (!kernelNode?.kernelId || !server) return empty();
    try {
      const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
      const r = await manager.complete(server, kernelNode.kernelId, msg.code, msg.cursorPos, ids);
      send({ type: 'completeResult', reqId: msg.reqId, matches: r.matches, cursorStart: r.cursorStart, cursorEnd: r.cursorEnd });
    } catch {
      empty();
    }
  }

  /**
   * Kernel introspection (hover / signature help). Resolves the cell's bound kernel and
   * asks it to inspect the live code at the cursor; returns the text/plain doc (or empty).
   */
  private async handleInspect(
    msg:      { reqId: string; cellNodeId: string; code: string; cursorPos: number },
    manager:  KernelManager,
    document: SkenaDocument,
    send:     (m: HostToWebview) => void,
  ): Promise<void> {
    const empty = () => send({ type: 'inspectResult', reqId: msg.reqId, found: false, text: '' });
    const canvas = document.canvas;
    const codeNode = canvas.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code');
    if (!codeNode) return empty();
    const nodeById = new Map(canvas.nodes.map(n => [n.id, n]));
    const kid = resolveBoundKernel(codeNode.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
    const kernelNode = kid ? nodeById.get(kid) as KernelNode | undefined : undefined;
    const server = kernelNode ? manager.serverByName(kernelNode.server) : undefined;
    if (!kernelNode?.kernelId || !server) return empty();
    try {
      const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
      const r = await manager.inspect(server, kernelNode.kernelId, msg.code, msg.cursorPos, ids);
      send({ type: 'inspectResult', reqId: msg.reqId, found: r.found, text: r.text });
    } catch {
      empty();
    }
  }

  /**
   * Restart or shut down the kernel a kernel node points at (its right-click menu).
   * Shutdown clears the node's kernelId so its LED goes grey and the next run starts
   * a fresh kernel; restart keeps the same id (Jupyter wipes the namespace).
   */
  // - reset run-flags (and the stale kernelId) for kernel nodes whose kernel is no longer live, so
  // - run-with-upstream re-runs everything against a wiped namespace. Guarded: acts only when the
  // - kernel's SERVER responded to the poll but the kernelId is absent (a fully unreachable server
  // - is ambiguous — a live kernel could just be momentarily unreported — so it's left alone).
  private async reconcileRunFlags(document: SkenaDocument, kernels: KernelStatusEntry[]): Promise<void> {
    const canvas           = document.canvas;
    const liveIds          = new Set(kernels.map(k => k.kernelId));
    const reachableServers = new Set(kernels.map(k => k.server));
    const typeOf           = (id: string) => canvas.nodes.find(n => n.id === id)?.type;
    let changed = false;
    for (const kn of canvas.nodes) {
      if (kn.type !== 'kernel') continue;
      const k = kn as KernelNode;
      if (!k.kernelId || !reachableServers.has(k.server) || liveIds.has(k.kernelId)) continue;
      const bound = new Set(resolveKernelCells(k.id, canvas.edges, id => typeOf(id) === 'code', id => typeOf(id) === 'kernel'));
      for (const n of canvas.nodes) {
        if (n.type === 'code' && bound.has(n.id) && (n as CodeNode).lastStatus !== undefined) {
          (n as CodeNode).lastStatus = undefined;
          changed = true;
        }
      }
      k.kernelId = undefined;   // - drop the dead id so the next run starts a fresh kernel
      changed = true;
    }
    if (changed) await writeCanvas(document.uri.fsPath, canvas);
  }

  private async handleKernelAction(
    msg:      { action: 'restart' | 'shutdown' | 'interrupt' | 'start'; kernelNodeId: string },
    manager:  KernelManager,
    document: SkenaDocument,
  ): Promise<void> {
    const canvas = document.canvas;
    const kernelNode = canvas.nodes.find(n => n.id === msg.kernelNodeId && n.type === 'kernel') as KernelNode | undefined;
    if (!kernelNode) return;
    const server = manager.serverByName(kernelNode.server);
    if (!server) return;   // - 'start' needs no live kernel; the others are guarded below
    const name = kernelNode.displayName ?? 'kernel';
    // - restart/shutdown wipe the kernel namespace → every bound cell is effectively un-run, so clear
    // - their run-flag (lastStatus). Interrupt keeps variables, so it must NOT reset. The plain write
    // - (no self-save suppression) makes the file-watcher soft-reload the cleared flags into the webview.
    const resetBoundCellFlags = async (): Promise<void> => {
      const typeOf = (id: string) => canvas.nodes.find(n => n.id === id)?.type;
      const bound  = new Set(resolveKernelCells(kernelNode.id, canvas.edges, id => typeOf(id) === 'code', id => typeOf(id) === 'kernel'));
      for (const n of canvas.nodes) {
        if (n.type === 'code' && bound.has(n.id)) (n as CodeNode).lastStatus = undefined;
      }
      await writeCanvas(document.uri.fsPath, canvas);
    };
    try {
      if (msg.action === 'start') {
        if (kernelNode.kernelId) return;   // - already running
        // - launch a fresh kernel from the node's kernelspec (recover it from displayName for older
        //   nodes), assign the new id, and plain-write so the webview reload picks up the live kernel
        let spec = kernelNode.spec;
        if (!spec && kernelNode.displayName) {
          try {
            const specs = await listKernelSpecs(server);
            spec = specs.find(s => s.displayName === kernelNode.displayName || s.name === kernelNode.displayName)?.name;
          } catch { /* - specs unavailable → ensureKernel falls back to python3 */ }
        }
        kernelNode.kernelId = await manager.ensureKernel(server, undefined, spec);
        if (spec && kernelNode.spec !== spec) kernelNode.spec = spec;   // - heal older nodes
        await writeCanvas(document.uri.fsPath, canvas);
        void vscode.window.showInformationMessage(`Skena: started ${name}.`);
        return;
      }
      if (!kernelNode.kernelId) return;   // - restart / interrupt / shutdown need a live kernel
      if (msg.action === 'restart') {
        await manager.restart(server, kernelNode.kernelId);
        await resetBoundCellFlags();
        void vscode.window.showInformationMessage(`Skena: restarted ${name} — cell run-flags reset.`);
      } else if (msg.action === 'interrupt') {
        await manager.interrupt(server, kernelNode.kernelId);
        void vscode.window.showInformationMessage(`Skena: interrupted ${name}.`);
      } else {
        await manager.shutdown(server, kernelNode.kernelId);
        kernelNode.kernelId = undefined;
        await resetBoundCellFlags();   // - also persists the cleared kernelId
        void vscode.window.showInformationMessage(`Skena: shut down ${name} — cell run-flags reset.`);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`Skena: kernel ${msg.action} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // - interrupt (SIGINT) the kernel running a specific code cell. Resolves the cell's bound kernel
  // - the same way a run does (BFS through edges), so a chained cell interrupts the shared kernel.
  private async handleInterruptCell(
    msg:      MsgInterruptCell,
    manager:  KernelManager,
    document: SkenaDocument,
  ): Promise<void> {
    const canvas = document.canvas;
    const cell = canvas.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
    if (!cell) return;
    const nodeById = new Map(canvas.nodes.map(n => [n.id, n]));
    const kernelNodeId = resolveBoundKernel(cell.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
    const kernelNode = kernelNodeId ? nodeById.get(kernelNodeId) as KernelNode | undefined : undefined;
    const server = kernelNode ? manager.serverByName(kernelNode.server) : undefined;
    if (!kernelNode || !kernelNode.kernelId || !server) {
      void vscode.window.showWarningMessage('Skena: no running kernel bound to this cell.');
      return;
    }
    if (msg.confirm) {
      const choice = await vscode.window.showWarningMessage(
        'Interrupt this cell’s execution?', { modal: true }, 'Interrupt',
      );
      if (choice !== 'Interrupt') return;
    }
    try {
      await manager.interrupt(server, kernelNode.kernelId);
    } catch (e) {
      void vscode.window.showErrorMessage(`Skena: interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * "Skena: Add Kernel" — QuickPick over configured Jupyter servers. Two groups:
   * "Start new kernel" lists the server's kernel specs (the environments), and
   * "Running kernels" lists live kernels (named by their session) to attach to.
   * The chosen kernel becomes a KernelNode delivered via addNodeResult.
   */
  private async handleAddKernel(
    msg:      MsgAddKernel,
    manager:  KernelManager,
    document: SkenaDocument,
    send:     (m: HostToWebview) => void,
  ): Promise<void> {
    const servers = manager.allServers();
    if (!servers.length) {
      void vscode.window.showWarningMessage('Skena: no Jupyter kernels configured (skena.jupyter.kernels or ~/.aix/xlmcp/.env).');
      return;
    }

    type Item = vscode.QuickPickItem & { server?: string; kernelId?: string; specName?: string; display?: string; start?: boolean };
    const sep = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const items: Item[] = [];
    for (const s of servers) {
      // - start-new: the kernel specs (environments) this server can launch
      items.push(sep(`${s.name} — start new kernel`));
      try {
        for (const spec of await listKernelSpecs(s)) items.push({
          label: `$(add) ${spec.displayName}`, description: 'new kernel',
          server: s.name, specName: spec.name, display: spec.displayName, start: true,
        });
      } catch { /* - specs unavailable on this server */ }
      // - attach: live kernels, labelled by the notebook/session they belong to
      try {
        const [kernels, sessions] = await Promise.all([
          listKernels(s),
          listSessions(s).catch(() => new Map<string, string>()),
        ]);
        if (kernels.length) items.push(sep(`${s.name} — running kernels`));
        for (const k of kernels) {
          const where = sessions.get(k.id);
          items.push({
            label: `$(debug-disconnect) ${where || k.name}`,
            description: `attach · ${k.state} · ${k.id.slice(0, 8)}`,
            server: s.name, kernelId: k.id, display: k.name,
          });
        }
      } catch { /* - server unreachable */ }
    }

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Start a new kernel from a spec, or attach to a running one',
      matchOnDescription: true,
    });
    if (!pick || (!pick.start && !pick.kernelId)) return;

    let kernelId    = pick.kernelId;
    let displayName = pick.display ?? 'kernel';
    if (pick.start) {
      const server = manager.serverByName(pick.server as string);
      if (!server) return;
      try {
        const k = await startKernel(server, pick.specName);
        kernelId = k.id;
      } catch (e) {
        void vscode.window.showErrorMessage(`Skena: failed to start kernel: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    // - place where the webview asked (viewport centre for the command, or the right-click point for
    //   the context menu) so the kernel lands where the user is looking. Fall back to near the last
    //   node only when no position was supplied.
    let x: number, y: number;
    if (msg.position) {
      x = Math.round(msg.position.x);
      y = Math.round(msg.position.y);
    } else {
      const nodes = document.canvas.nodes;
      x = 200; y = 200;
      if (nodes.length) {
        const last = nodes[nodes.length - 1];
        x = last.x + last.width + 60;
        y = last.y;
      }
    }

    if (!pick.server) return;
    const node: KernelNode = {
      id:          `kernel-${Date.now().toString(36)}`,
      type:        'kernel',
      server:      pick.server,
      kernelId,
      displayName,
      spec:        pick.specName ?? pick.display,   // - remember the kernelspec so a restart relaunches the same env
      x, y, width: NODE_SIZE.kernel.w, height: NODE_SIZE.kernel.h,
    };
    send({ type: 'addNodeResult', node, autoEdit: false });
  }

  // ─── Floating chat handlers ──────────────────────────────────────────────────

  /** Handle a floating chat message: build context, call Claude, stream back. */
  private async handleFloatingChatSend(
    msg:       MsgFloatingChatSend,
    panel:     vscode.WebviewPanel,
    document:  SkenaDocument,
    canvasDir: string,
    resolver:  FileResolver,
  ): Promise<void> {
    const send = (m: HostToWebview) => panel.webview.postMessage(m);

    // - history arrives from the webview; persist to workspaceState so it
    // - survives panel close and canvas rename (keyed by URI, not filename)
    const historyKey = `skena.chatHistory.${document.uri.toString()}`;
    await this.context.workspaceState.update(historyKey, msg.history ?? []);

    // - drop the last entry — that's the user message we're handling right now,
    // - already captured separately as msg.message
    const priorHistory = (msg.history ?? [])
      .slice(0, -1)
      .filter((m): m is Extract<ChatItem, { kind: 'text' }> => (m as ChatItem).kind === 'text')
      .map(m => ({ role: m.role, content: m.content }));

    // - harness agent has a Read tool → give it file paths (handles .ipynb etc);
    // - other adapters have no file tools → inline content as before
    const aiCfg          = vscode.workspace.getConfiguration('skena.ai');
    const provider       = aiCfg.get<string>('provider') ?? 'anthropic';
    const restoreSession = aiCfg.get<boolean>('session.restore') ?? true;
    const sessionKey     = `skena.chatSession.${document.uri.toString()}`;
    const sessionId      = restoreSession ? this.context.workspaceState.get<string>(sessionKey) ?? null : null;

    const resolveFsPath = (uri: string) => {
      const r = resolver.resolve(uri, canvasDir);
      return r && !r.isNotion ? r.fsPath : null;
    };

    // - harness: static role is set once at spawn; the live canvas snapshot is
    //   folded into THIS message (the persistent CC process keeps prior turns,
    //   so history is never re-sent). Other adapters: full system + replayed history.
    let systemPrompt: string;
    let apiHistory: { role: 'user' | 'assistant'; content: string }[];
    try {
      if (provider === 'harness') {
        systemPrompt = buildStaticSystemPrompt(path.basename(document.uri.fsPath, '.canvas'));
        const snapshot = await buildCanvasContext(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'path', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [{ role: 'user', content: `${snapshot}\n\n---\n\n${msg.message}` }];
      } else {
        systemPrompt = await buildSystemPrompt(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'content', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [...priorHistory, { role: 'user', content: msg.message }];
      }
    } catch (e) {
      send({ type: 'floatingChatError', message: `Context error: ${(e as Error).message}` });
      return;
    }

    // - harness provider needs the canvas path + workspace dir to target its MCP server
    const workspaceDir = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
                      ?? path.dirname(document.uri.fsPath);

    const client = await this.llmClient();
    await client.chat(systemPrompt, apiHistory, CANVAS_TOOLS, {
      onText: (delta) => {
        send({ type: 'floatingChatDelta', delta });
      },

      onToolUse: async (tool) => {
        if (tool.name === 'add_note') {
          const content = (tool.input['content'] as string) ?? '';
          const addResult = this.addNoteToCanvas(document, msg.activeNodeId, content);
          if (addResult) {
            send({ type: 'floatingChatNodeAdded', node: addResult.node, edge: addResult.edge });
          }
          // - save canvas to disk
          try {
            await writeCanvas(document.uri.fsPath, document.canvas);
          } catch { /* non-fatal */ }
          return content ? 'Note added to canvas.' : 'No content provided.';
        }

        if (tool.name === 'read_node') {
          const label = (tool.input['label'] as string) ?? '';
          const node  = document.canvas.nodes.find(n => n.nodeLabel === label);
          if (!node) return `No node with label ${label} found.`;
          const content = await nodeContent(node, canvasDir, 3000);
          return content || '(empty)';
        }

        if (tool.name === 'list_nodes') {
          const lines = document.canvas.nodes
            .filter(n => n.type !== 'group')
            .map(n => `[${n.nodeLabel ?? n.id.slice(0, 6)}] (${n.type}) ${nodeTitle(n)}`);
          return lines.join('\n') || '(no nodes)';
        }

        return 'Unknown tool.';
      },

      onDone:  (usage) => send({ type: 'floatingChatDone', costUsd: usage?.costUsd, deltaUsd: usage?.deltaUsd }),
      onError: (message) => send({ type: 'floatingChatError', message }),
      onToolEvent: (event) => send({ type: 'floatingChatToolEvent', event }),
      onUsage:     (usage) => send({ type: 'floatingChatUsage', usage }),
      // - persist the CC session id so the next open can --resume it
      onSessionId: (id) => { void this.context.workspaceState.update(sessionKey, id); },
    }, {
      canvasPath:   document.uri.fsPath,
      activeNodeId: msg.activeNodeId,
      workspaceDir,
      sessionId,
      restoreSession,
      model:        document.canvas.metadata?.aiModel,
    });
  }

  /**
   * Create a TextNode and edge connecting it to the active node.
   * Mutates `document.canvas` in place (same pattern as MCP tools do).
   */
  private addNoteToCanvas(
    document:     SkenaDocument,
    activeNodeId: string | null,
    content:      string,
  ): { node: CanvasNode; edge?: CanvasEdge } | null {
    if (!content.trim()) return null;

    const canvas = document.canvas;

    // - compute position: right of active node (or canvas centre)
    let x = 200, y = 200;
    const activeNode = activeNodeId ? canvas.nodes.find(n => n.id === activeNodeId) : null;
    if (activeNode) {
      x = activeNode.x + activeNode.width + 60;
      y = activeNode.y;
    } else if (canvas.nodes.length > 0) {
      const last = canvas.nodes[canvas.nodes.length - 1];
      x = last.x + last.width + 60;
      y = last.y;
    }

    // - generate id and label
    const id = `ai-${Date.now().toString(36)}`;

    const nodeBase: CanvasNode = {
      id,
      type:        'text',
      x,
      y,
      width:       340,
      height:      160,
      text:        content,
      createdBy:   'ai',
      lastTouched: Date.now(),
    } as TextNode;

    const node = assignLabel(nodeBase, canvas.nodes) as CanvasNode;

    canvas.nodes.push(node);

    // - connect to active node if one exists
    let edge: CanvasEdge | undefined;
    if (activeNodeId) {
      edge = {
        id:       `e-${id}`,
        fromNode: activeNodeId,
        toNode:   id,
        toEnd:    'arrow',
      };
      canvas.edges.push(edge);
    }

    return { node, edge };
  }

  private async handleChatMessage(
    msg: MsgChatMessage,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    // - Phase 5: AI chat node — placeholder
    panel.webview.postMessage({
      type: 'chatChunk',
      nodeId: msg.nodeId,
      delta: '[AI chat coming in Phase 5]',
      done: true,
    } satisfies HostToWebview);
  }

  // ─── webview HTML ────────────────────────────────────────────────────────────

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );
    const plotlyUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'plotly.min.js')
    );

    // - Content Security Policy: allow scripts from extension dist + vscode-resource
    // - https: in style-src / font-src is required for user-configured markdown.styles
    // - (e.g. cdn.jsdelivr.net CSS that may also reference external fonts)
    const csp = [
      `default-src 'none'`,
      // - wasm-unsafe-eval: shiki's oniguruma syntax-highlighter is WebAssembly; without
      // - this the WASM compile is CSP-blocked (breaks code highlighting in nodes + CodeRenderer)
      `script-src ${webview.cspSource} 'unsafe-inline' 'wasm-unsafe-eval'`,
      `style-src ${webview.cspSource} 'unsafe-inline' https:`,
      `img-src ${webview.cspSource} data: blob: https:`,
      `font-src ${webview.cspSource} data: https:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skena Canvas</title>
  <link rel="stylesheet" href="${styleUri}" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
  </style>
</head>
<body>
  <div id="root" data-plotly-uri="${plotlyUri}"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ─── SkenaDocument ────────────────────────────────────────────────────────────

export class SkenaDocument implements vscode.CustomDocument {
  private _canvas: CanvasData = { nodes: [], edges: [] };

  constructor(readonly uri: vscode.Uri) {}

  get canvas(): CanvasData { return this._canvas; }

  updateFromDisk(canvas: CanvasData): void {
    this._canvas = canvas;
  }

  dispose(): void {}
}
