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
import {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  FileNode,
  HostToWebview,
  WebviewToHost,
  MsgRequestFile,
  MsgSaveCanvas,
  MsgOpenFile,
  MsgSearchVault,
  MsgChatMessage,
  MsgAddNodeRequest,
} from '../shared/types';
import { MAX_FILE_SIZE_BYTES } from '../shared/constants';

export class SkenaEditorProvider implements vscode.CustomEditorProvider<SkenaDocument> {
  static readonly viewType = 'skena.canvasEditor';

  /**
   * Active panel reference — updated via onDidChangeViewState so the
   * skena.addNode VS Code command can post a trigger to the focused canvas.
   */
  static activePanel: vscode.WebviewPanel | null = null;

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
    const config = vscode.workspace.getConfiguration('skena');
    const vaults = config.get<Array<{ name: string; path: string }>>('skena.vaults') ?? [];
    const canvasDir = path.dirname(document.uri.fsPath);
    const resolver = new FileResolver(vaults);

    // - flag to suppress file watcher events triggered by our own saves
    let isSelfSaving = false;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(canvasDir),
        ...vaults.map(v => vscode.Uri.file(
          v.path.startsWith('~') ? path.join(process.env.HOME ?? '~', v.path.slice(1)) : v.path
        )),
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
            const canvas = await readCanvas(document.uri.fsPath);
            document.updateFromDisk(canvas);
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
            send({ type: 'vaultIndex', entries: this.indexer.all() });
            // - forward VS Code markdown preview settings so the webview matches the editor look
            const mdPreview = vscode.workspace.getConfiguration('markdown.preview');
            const md        = vscode.workspace.getConfiguration('markdown');
            send({
              type: 'markdownConfig',
              config: {
                fontFamily: mdPreview.get<string>('fontFamily'),
                fontSize:   mdPreview.get<number>('fontSize'),
                styles:     md.get<string[]>('styles') ?? [],
              },
            });
          } catch (e) {
            vscode.window.showErrorMessage(`Skena: failed to open canvas: ${e}`);
          }
          break;
        }
        case 'requestFile':  await this.handleRequestFile(msg, panel, document, resolver, canvasDir); break;
        case 'saveCanvas':   await this.handleSaveCanvas(msg, document, v => { isSelfSaving = v; }); break;
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
        case 'chatMessage':  await this.handleChatMessage(msg, panel); break;
        case 'dropFiles':    this.handleDropFiles(msg.uris, msg.position, canvasDir, resolver, send); break;
        case 'addNodeRequest': await this.handleAddNodeRequest(msg, canvasDir, resolver, send); break;
      }
    });

    // - watch for external changes to the .canvas file itself (Obsidian, git pull)
    // - isSelfSaving suppresses the reload cycle when WE wrote the file
    const canvasWatcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
    canvasWatcher.onDidChange(async () => {
      if (isSelfSaving) return;
      try {
        const canvas = await readCanvas(document.uri.fsPath);
        document.updateFromDisk(canvas);
        send({ type: 'canvasChanged' });
        setTimeout(() => {
          send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
        }, 50);
      } catch { /* ignore parse errors during in-progress external edits */ }
    });

    // - helper: convert an absolute fsPath to the URI the canvas node uses
    const toCanvasUri = (fsPath: string): string => {
      // - vault file → vault:// URI
      const vaultUri = resolver.resolveFromFsPath(fsPath);
      if (vaultUri) return vaultUri;
      // - project file → relative path from canvas dir (same format as drop creates)
      const rel = path.relative(canvasDir, fsPath).replace(/\\/g, '/');
      return rel.startsWith('..') ? fsPath : (rel.startsWith('./') ? rel : `./${rel}`);
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
      // - size limit only applies to text files (markdown, python, yaml);
      // - images are sent as self-contained data URIs so size is not a display issue
      if (resolved.fileType !== 'image' && stat.size > MAX_FILE_SIZE_BYTES) {
        send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: 'TOO_LARGE' });
        return;
      }

      let content: string;
      let resourceUri: string | undefined;

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
        const raw = await fs.readFile(resolved.fsPath, 'utf-8');
        content = JSON.stringify(parseNotebook(raw));
      } else {
        content = await fs.readFile(resolved.fsPath, 'utf-8');
      }

      console.log(`[Skena] handleRequestFile: uri=${msg.uri} fileType=${resolved.fileType} resourceUri=${resourceUri ? resourceUri.slice(0, 40) + '…' : 'none'}`);
      send({
        type: 'fileContent',
        requestId: msg.requestId,
        uri: msg.uri,
        fileType: resolved.fileType,
        content,
        resourceUri,
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
  ): Promise<void> {
    try {
      setSelfSaving(true);
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

    type Item = vscode.QuickPickItem & { canvasUri: string };

    const vaultItems: Item[] = vaultEntries.map(e => ({
      label:       e.title,
      description: e.type ?? '',
      detail:      e.tags.length ? e.tags.join('  ·  ') : undefined,
      canvasUri:   e.uri,
    }));

    const wsItems: Item[] = wsUris
      .filter(u => !vaultPaths.has(u.fsPath))
      .map(u => ({
        label:       path.basename(u.fsPath),
        description: vscode.workspace.asRelativePath(u.fsPath),
        canvasUri:   (() => {
          const rel = path.relative(canvasDir, u.fsPath).replace(/\\/g, '/');
          return rel.startsWith('.') ? rel : `./${rel}`;
        })(),
      }));

    const items: Item[] = [
      ...(vaultItems.length ? [
        { label: 'Vault', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
        ...vaultItems,
      ] : []),
      ...(wsItems.length ? [
        { label: 'Workspace', kind: vscode.QuickPickItemKind.Separator, canvasUri: '' },
        ...wsItems,
      ] : []),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder:       'Search vault and workspace files to add…',
      matchOnDescription: true,
      matchOnDetail:      true,
    });

    if (!picked || !picked.canvasUri) return; // - cancelled or separator clicked

    const nodeId = `node-${Date.now()}`;
    const newNode: FileNode = {
      id:     nodeId,
      type:   'file',
      file:   picked.canvasUri,
      x:      Math.round(msg.position.x),
      y:      Math.round(msg.position.y),
      width:  400,
      height: 300,
    };

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

    send({ type: 'addNodeResult', node: newNode, edge });
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
