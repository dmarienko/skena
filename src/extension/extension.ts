/**
 * Skena VS Code Extension — activation entry point.
 *
 * Registers:
 * - Custom editor provider for *.canvas files
 * - Commands: openCanvas, addNode, quickSearch, new* entries
 * - Vault indexer + file watcher lifecycle
 */

import * as vscode from 'vscode';
import { SkenaEditorProvider } from './editor-provider';
import { VaultIndexer } from './vault-indexer';
import { FileWatcher } from './file-watcher';

let indexer: VaultIndexer | undefined;
let watcher: FileWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('Skena: activating');

  // - shared indexer instance — all editor panels share one index
  indexer = new VaultIndexer(context);
  watcher = new FileWatcher(indexer);

  // - register the custom editor for *.canvas files
  const editorProvider = new SkenaEditorProvider(context, indexer, watcher);
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
    })
  );

  // - start watching vaults configured in settings
  const config = vscode.workspace.getConfiguration('skena');
  const vaults = config.get<Array<{ name: string; path: string }>>('skena.vaults') ?? [];
  watcher.startWatching(vaults);
  indexer.reindex(vaults);

  // - re-index when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('skena.vaults') || e.affectsConfiguration('skena.vaultDirectories')) {
        const updated = vscode.workspace.getConfiguration('skena');
        const updatedVaults = updated.get<Array<{ name: string; path: string }>>('skena.vaults') ?? [];
        watcher?.startWatching(updatedVaults);
        indexer?.reindex(updatedVaults);
      }
    })
  );

  console.log('Skena: activated');
}

export function deactivate(): void {
  watcher?.dispose();
  indexer?.dispose();
}
