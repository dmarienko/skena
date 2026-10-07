/**
 * Go to definition in a code cell (leader g), the webview's half. The dotted name under the cursor goes
 * to the host (goToDefinition); its answer (definitionResult) selects a cell here (skena:goToCell,
 * CanvasView), or goes back to the host to open a file or show a quick pick (showDefinitions). With no
 * name under the cursor nothing is asked and nothing shown (user). An answer that arrives after
 * another key in the cell or after the cell lost focus is dropped: the user has moved on, and keys
 * typed meanwhile must not land in another cell.
 */
import type { editor as MonacoEditor } from 'monaco-editor';
import { dottedNameAt } from '../../../shared/goToDefinition';
import type { MsgDefinitionResult } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - one lookup per cell at a time; `since` is performance.now() when it was asked
interface Pending { reqId: string; name: string; since: number; stale: boolean; note: (text: string) => void }
const pending = new Map<string, Pending>();
let counter = 0;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('skena:definitionResult', (e: Event) => {
    const r = (e as CustomEvent<MsgDefinitionResult>).detail;
    const p = pending.get(r.cellNodeId);
    if (!p || p.reqId !== r.reqId) return;
    pending.delete(r.cellNodeId);
    if (p.stale) return;
    if (r.targets.length === 0) { p.note(`no definition found for ${p.name}`); return; }
    const only = r.targets.length === 1 ? r.targets[0] : null;
    if (only?.kind === 'cell') {
      window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: only.cellId, line: only.line, col: only.col } }));
      return;
    }
    vscodePostMessage({ type: 'showDefinitions', targets: r.targets });
  });
}

/** - leader g in `cellId`'s editor: ask the host where the name under the cursor is defined; `note` shows a line in the cell */
export function requestDefinition(editor: MonacoEditor.IStandaloneCodeEditor, cellId: string, note: (text: string) => void): void {
  listen();
  const pos = editor.getPosition();
  const model = editor.getModel();
  if (!pos || !model) return;
  const at = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column);
  if (!at) return;
  const reqId = `def-${++counter}`;
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note });
  vscodePostMessage({ type: 'goToDefinition', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column, name: at.dotted });
}

/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
export function dropLookup(cellId: string, when: number): void {
  const p = pending.get(cellId);
  if (p && when > p.since) p.stale = true;
}
