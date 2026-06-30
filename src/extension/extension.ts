/**
 * Skena VS Code Extension — activation entry point.
 *
 * Registers:
 * - Custom editor provider for *.canvas files
 * - Commands: openCanvas, addNode, quickSearch, new* entries
 * - Vault indexer + file watcher lifecycle
 */

import * as vscode from 'vscode';
import * as fs     from 'fs/promises';
import * as path   from 'path';
import { SkenaEditorProvider } from './editor-provider';
import { VaultIndexer } from './vault-indexer';
import { FileWatcher } from './file-watcher';
import { getVaults } from './settings';

let indexer: VaultIndexer | undefined;
let watcher: FileWatcher | undefined;
let editorProvider: SkenaEditorProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Skena: activating');

  // - shared indexer instance — all editor panels share one index
  indexer = new VaultIndexer(context);
  watcher = new FileWatcher(indexer);

  // - register the custom editor for *.canvas files
  editorProvider = new SkenaEditorProvider(context, indexer, watcher);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'skena.canvasEditor',
      editorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,  // - keep webview alive when tab not focused
          enableFindWidget: false,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // - commands
  context.subscriptions.push(
    vscode.commands.registerCommand('skena.openCanvas', () => {
      // - opens a file picker filtered to *.canvas
      vscode.window.showOpenDialog({
        filters: { 'Canvas files': ['canvas'] },
        canSelectMany: false,
      }).then(uris => {
        if (uris?.[0]) {
          vscode.commands.executeCommand('vscode.openWith', uris[0], 'skena.canvasEditor');
        }
      });
    }),

    vscode.commands.registerCommand('skena.quickSearch', async () => {
      if (!indexer) return;
      const entry = await indexer.quickPick();
      if (entry?.fsPath) {
        const doc = await vscode.workspace.openTextDocument(entry.fsPath);
        vscode.window.showTextDocument(doc);
      }
    }),

    vscode.commands.registerCommand('skena.newStrategy', () => {
      // - placeholder, implemented in commands/create-entry.ts
      vscode.window.showInformationMessage('Skena: New Strategy — coming in Phase 3');
    }),

    vscode.commands.registerCommand('skena.newKnowledge', () => {
      vscode.window.showInformationMessage('Skena: New Knowledge — coming in Phase 3');
    }),

    vscode.commands.registerCommand('skena.newResearchLog', () => {
      vscode.window.showInformationMessage('Skena: New Research Log — coming in Phase 3');
    }),

    // - Ctrl+N override: VS Code intercepts ctrl+n ("New File") before the webview sees it.
    // - This command is bound to ctrl+n when a canvas editor is active (see package.json
    // - keybindings). It sends an addNodeTrigger to the active panel; the webview
    // - computes the viewport centre and sends back an addNodeRequest.
    vscode.commands.registerCommand('skena.addNode', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) return;
      panel.webview.postMessage({ type: 'addNodeTrigger' });
    }),

    // - Ctrl+Shift+J / Ctrl+Shift+K overrides: VS Code intercepts these globally
    // - ("Toggle Panel" / "Delete Line") before the webview keydown handler fires.
    // - Route them through commands with `when: activeCustomEditorId == skena.canvasEditor`.
    vscode.commands.registerCommand('skena.addTextNodeDown', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) return;
      panel.webview.postMessage({ type: 'addTextNodeTrigger', direction: 'J' });
    }),

    vscode.commands.registerCommand('skena.addTextNodeUp', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) return;
      panel.webview.postMessage({ type: 'addTextNodeTrigger', direction: 'K' });
    }),

    // - Ctrl+Shift+Left / Ctrl+Shift+Right: intercepted by VS Code ("select word")
    vscode.commands.registerCommand('skena.addTextNodeLeft', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) return;
      panel.webview.postMessage({ type: 'addTextNodeTrigger', direction: 'H' });
    }),

    vscode.commands.registerCommand('skena.addTextNodeRight', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) return;
      panel.webview.postMessage({ type: 'addTextNodeTrigger', direction: 'L' });
    })
  );

  // - deploy MCP server to each workspace folder
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    await deployMcpServer(context, folder.uri.fsPath).catch(e =>
      console.error('Skena: MCP server deploy failed:', e)
    );
  }

  // - start watching vaults (merged from settings.json + settings.local.json)
  const vaults = await getVaults();
  console.log(`Skena: getVaults() returned ${vaults.length} vault(s):`, vaults.map(v => v.name));
  watcher.startWatching(vaults);
  indexer.reindex(vaults);

  // - re-index when settings change (either file)
  const reindexFromSettings = async () => {
    const updated = await getVaults();
    watcher?.startWatching(updated);
    indexer?.reindex(updated);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('skena.vaults') || e.affectsConfiguration('skena.vaultDirectories')) {
        reindexFromSettings();
      }
    })
  );

  console.log('Skena: activated');
}

export function deactivate(): void {
  editorProvider?.dispose();   // - kill persistent harness CC processes
  watcher?.dispose();
  indexer?.dispose();
}

async function deployMcpServer(context: vscode.ExtensionContext, workspaceRoot: string): Promise<void> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const mcpJs     = path.join(vscodeDir, 'skena-mcp.js');
  const mcpJson   = path.join(workspaceRoot, '.mcp.json');
  const srcScript = context.asAbsolutePath('dist/mcp-server.js');

  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.copyFile(srcScript, mcpJs);

  // - write .mcp.json only if it doesn't already list skena
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await fs.readFile(mcpJson, 'utf-8')) as Record<string, unknown>; } catch { /* new file */ }
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  if (!servers.skena) {
    servers.skena        = { type: 'stdio', command: 'node', args: ['.vscode/skena-mcp.js'] };
    existing.mcpServers  = servers;
    await fs.writeFile(mcpJson, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  }
}
