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
import * as fs from 'fs/promises';
import { readCanvas, writeCanvas } from './canvas-io';
import { FileResolver } from './file-resolver';
import { VaultIndexer } from './vault-indexer';
import { FileWatcher } from './file-watcher';
import { parseNotebook } from './notebook-parser';
import { renderMarkdownToHtml } from './markdown-html';
import { getVaults } from './settings';
import { ClaudeClient } from './claude-client';
import { buildSystemPrompt, nodeTitle, nodeContent } from './context-builder';
import { assignLabel } from '../shared/nodeLabels';
import {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  FileNode,
  TextNode,
  LinkNode,
  PortalNode,
  HostToWebview,
  WebviewToHost,
  MsgRequestFile,
  MsgSaveCanvas,
  MsgOpenFile,
  MsgSearchVault,
  MsgChatMessage,
  MsgAddNodeRequest,
  MsgMoveToSubCanvas,
  MsgFloatingChatSend,
  ChatMessage,
  MsgFloatingChatHistoryRestored,
  MsgFloatingChatSaveUIState,
  MsgSaveMarks,
  MsgMarksRestored,
  CanvasMark,
} from '../shared/types';
import { MAX_FILE_FULL_BYTES, MAX_FILE_PREVIEW_BYTES, MAX_NOTEBOOK_BYTES } from '../shared/constants';

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

  /** - one shared Claude client per editor provider instance */
  private readonly claudeClient = new ClaudeClient();

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
    // - last JSON we wrote, so we can detect an external write (e.g. MCP) that
    // - arrives while isSelfSaving is true and not suppress it incorrectly
    let lastWrittenJson = '';

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

    // - send initial canvas data once webview signals ready
    const send = (msg: HostToWebview) => panel.webview.postMessage(msg);

    // - handle messages from webview
    panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      switch (msg.type) {
        case 'webviewReady': {
          // - webview is mounted and listening — now safe to send canvas data
          try {
            // - read canvas and clipboard in parallel; clipboard pre-warm ensures
            // - that vim's `p` works immediately on first open even in a fresh
            // - cross-canvas webview where clipboardCache starts empty.
            const [canvas, clipboardText] = await Promise.all([
              readCanvas(document.uri.fsPath),
              vscode.env.clipboard.readText(),
            ]);
            document.updateFromDisk(canvas);
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
            // - push clipboard content unprompted; webview caches it in clipboardCache
            // - so vim paste works before any requestClipboardRead round-trip completes
            send({ type: 'clipboardContent', text: clipboardText });
            send({ type: 'vaultIndex', entries: this.indexer.all() });
            // - restore chat state from workspaceState (survives panel close + rename)
            const historyKey = `skena.chatHistory.${document.uri.toString()}`;
            const uiKey      = `skena.chatUI.${document.uri.toString()}`;
            const savedHistory = this.context.workspaceState.get<ChatMessage[]>(historyKey) ?? [];
            const savedUI      = this.context.workspaceState.get<{ collapsed?: boolean; pos?: { x: number; y: number }; size?: { w: number; h: number } }>(uiKey);
            send({
              type:      'floatingChatHistoryRestored',
              history:   savedHistory,
              collapsed: true,              // - always start collapsed; user opens explicitly
              pos:       savedUI?.pos,
              size:      savedUI?.size,
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
            send({
              type: 'markdownConfig',
              config: {
                fontFamily:         mdPreview.get<string>('fontFamily'),
                fontSize:           mdPreview.get<number>('fontSize'),
                styles:             md.get<string[]>('styles') ?? [],
                notebookShowSource: nbCfg.showSourceCells ?? false,
              },
            });
          } catch (e) {
            vscode.window.showErrorMessage(`Skena: failed to open canvas: ${e}`);
          }
          break;
        }
        case 'requestFile':  await this.handleRequestFile(msg, panel, document, resolver, canvasDir); break;
        case 'saveCanvas':   await this.handleSaveCanvas(msg, document, v => { isSelfSaving = v; }, s => { lastWrittenJson = s; }); break;
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
        case 'floatingChatSend':  await this.handleFloatingChatSend(msg, panel, document, canvasDir); break;
        case 'floatingChatAbort': this.claudeClient.abort(); break;
        case 'floatingChatSaveUIState': {
          const uiKey = `skena.chatUI.${document.uri.toString()}`;
          void this.context.workspaceState.update(uiKey, {
            collapsed: (msg as MsgFloatingChatSaveUIState).collapsed,
            pos:       (msg as MsgFloatingChatSaveUIState).pos,
            size:      (msg as MsgFloatingChatSaveUIState).size,
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
        case 'dropFiles':            this.handleDropFiles(msg.uris, msg.position, canvasDir, resolver, send); break;
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
        case 'copyAbsolutePath': {
          const resolved = resolver.resolve(msg.uri, canvasDir);
          if (resolved?.fsPath) {
            await vscode.env.clipboard.writeText(resolved.fsPath);
            vscode.window.setStatusBarMessage(`Copied: ${resolved.fsPath}`, 3000);
          }
          break;
        }
      }
    });

    // - watch for external changes to the .canvas file itself (Obsidian, git pull, MCP)
    // - isSelfSaving suppresses the reload cycle when WE wrote the file.
    // - But an external writer (e.g. MCP server) can write WHILE isSelfSaving is true,
    // - so when that flag is set we compare disk content to lastWrittenJson: if it
    // - differs, an external write slipped through and we must still reload the webview.
    const canvasWatcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
    canvasWatcher.onDidChange(async () => {
      if (isSelfSaving) {
        // - check whether this is our own echo or an external write
        try {
          const raw = await fs.readFile(document.uri.fsPath, 'utf-8');
          if (raw === lastWrittenJson) return; // - definitely our own echo, skip
          // - content differs → external write (MCP etc.) arrived during our save window
        } catch { return; }
      }
      try {
        const canvas = await readCanvas(document.uri.fsPath);
        document.updateFromDisk(canvas);
        send({ type: 'canvasChanged' });
        setTimeout(() => {
          send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
        }, 50);
      } catch { /* ignore parse errors during in-progress external edits */ }
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
    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.active) {
        SkenaEditorProvider.activePanel = webviewPanel;
      }
    });

    panel.onDidDispose(() => {
      if (SkenaEditorProvider.activePanel === panel) {
        SkenaEditorProvider.activePanel = null;
      }
      canvasWatcher.dispose();
      workspaceWatcher.dispose();
      saveDisposable.dispose();
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
      const json = JSON.stringify(msg.canvas, null, 2);
      setLastWrittenJson(json);
      await writeCanvas(document.uri.fsPath, msg.canvas);
      document.updateFromDisk(msg.canvas);
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

    const resolved = resolver.resolve(msg.uri, canvasDir);
    if (!resolved || resolved.isNotion) return;

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
        await vscode.window.showTextDocument(doc, { viewColumn, preview: !msg.modal });
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Skena: cannot open file: ${e}`);
    }
  }

  private handleDropFiles(
    rawUris: string[],
    position: { x: number; y: number },
    canvasDir: string,
    resolver: FileResolver,
    send: (m: HostToWebview) => void,
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
        width:  400,
        height: 300,
      };
      nodes.push(node);
    });

    if (nodes.length > 0) {
      send({ type: 'nodesFromDrop', nodes });
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

    let newNode: FileNode | TextNode | LinkNode | PortalNode;
    let autoEdit = false;

    if (picked.canvasUri === NEW_TEXT_NOTE) {
      // - inline text node — opens Monaco immediately so the user can start typing
      newNode = { id: nodeId, type: 'text', text: '', x, y, width: 400, height: 300 };
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
      newNode = { id: nodeId, type: 'link', url: url.trim(), x, y, width: 320, height: 80 };
    } else if (picked.canvasUri.endsWith('.canvas')) {
      // - .canvas file → portal node (circle shape, opens linked canvas on click)
      newNode = { id: nodeId, type: 'portal', canvas: picked.canvasUri, x, y, width: 200, height: 200 };
    } else {
      newNode = { id: nodeId, type: 'file', file: picked.canvasUri, x, y, width: 400, height: 300 };
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
      width:  200,
      height: 200,
    };

    send({
      type:         'subCanvasCreated',
      portalNode,
      movedNodeIds: msg.nodes.map(n => n.id),
    });
  }

  // ─── Floating chat handlers ──────────────────────────────────────────────────

  /** Handle a floating chat message: build context, call Claude, stream back. */
  private async handleFloatingChatSend(
    msg:       MsgFloatingChatSend,
    panel:     vscode.WebviewPanel,
    document:  SkenaDocument,
    canvasDir: string,
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
      .map(m => ({ role: m.role, content: m.content }));

    // - build system prompt with canvas context
    let systemPrompt: string;
    try {
      systemPrompt = await buildSystemPrompt(
        document.uri.fsPath,
        document.canvas,
        msg.activeNodeId,
      );
    } catch (e) {
      send({ type: 'floatingChatError', message: `Context error: ${(e as Error).message}` });
      return;
    }

    // - map prior history + current message → API format
    const apiHistory = [
      ...priorHistory,
      { role: 'user' as const, content: msg.message },
    ];

    await this.claudeClient.chat(systemPrompt, apiHistory, {
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

      onDone:  () => send({ type: 'floatingChatDone' }),
      onError: (message) => send({ type: 'floatingChatError', message }),
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

    // - Content Security Policy: allow scripts from extension dist + vscode-resource
    // - https: in style-src / font-src is required for user-configured markdown.styles
    // - (e.g. cdn.jsdelivr.net CSS that may also reference external fonts)
    const csp = [
      `default-src 'none'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
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
  <div id="root"></div>
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
