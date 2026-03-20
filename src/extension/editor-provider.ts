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
  FileNode,
  HostToWebview,
  WebviewToHost,
  MsgRequestFile,
  MsgSaveCanvas,
  MsgOpenFile,
  MsgSearchVault,
  MsgChatMessage,
} from '../shared/types';
import { MAX_FILE_SIZE_BYTES } from '../shared/constants';

export class SkenaEditorProvider implements vscode.CustomEditorProvider<SkenaDocument> {
  private static readonly viewType = 'skena.canvasEditor';

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
      send({ type: 'fileChanged', uri: toCanvasUri(doc.uri.fsPath) });
    });

    // - file system watcher covers external changes (git pull, Obsidian, other editors)
    const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{md,ipynb,py,yaml,yml}');
    workspaceWatcher.onDidChange(uri => {
      send({ type: 'fileChanged', uri: toCanvasUri(uri.fsPath) });
    });

    panel.onDidDispose(() => {
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
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        send({ type: 'fileError', requestId: msg.requestId, uri: msg.uri, error: 'TOO_LARGE' });
        return;
      }

      let content: string;
      let resourceUri: string | undefined;

      if (resolved.fileType === 'image') {
        // - for images, send the vscode-resource:// URI (not the raw bytes)
        resourceUri = resolver.toWebviewUri(resolved.fsPath, panel.webview);
        content = '';
      } else if (resolved.fileType === 'notebook') {
        const raw = await fs.readFile(resolved.fsPath, 'utf-8');
        content = JSON.stringify(parseNotebook(raw));
      } else {
        content = await fs.readFile(resolved.fsPath, 'utf-8');
      }

      send({
        type: 'fileContent',
        requestId: msg.requestId,
        uri: msg.uri,
        fileType: resolved.fileType,
        content,
        resourceUri,
      });
    } catch (e) {
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

    try {
      const doc = await vscode.workspace.openTextDocument(resolved.fsPath);
      // - open beside the canvas, not replacing it
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
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
    const csp = [
      `default-src 'none'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
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
