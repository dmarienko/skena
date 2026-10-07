/**
 * Go to definition (leader g) and find references (leader z) in a code cell, the webview's half. The
 * name under the cursor goes to the host (goToDefinition, findReferences). A definition answer
 * (definitionResult) selects a cell here (skena:goToCell, CanvasView), or goes back to the host to
 * open a file or show a quick pick (showDefinitions); a references answer (referencesResult) opens
 * the cell's reference peek (referencePeek.ts). No answer: a note in the cell; a references lookup
 * that failed: a note with its reason; a cell the jump goes to that is gone by then: a note too
 * (noteInCell, CanvasView). With no name under the
 * cursor nothing is asked and nothing shown (user). An answer that arrives after another key in the
 * cell or after the cell lost focus is dropped: the user has moved on, and keys typed meanwhile must
 * not land in another cell.
 */
import type { editor as MonacoEditor } from 'monaco-editor';
import { dottedNameAt } from '../../../shared/goToDefinition';
import type { ReferencesAnswer } from '../../../shared/findReferences';
import type { MsgDefinitionResult, MsgReferencesResult } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - one lookup per cell at a time; `since` is performance.now() when it was asked; `open` for references
interface Pending { reqId: string; name: string; since: number; stale: boolean; note: (text: string) => void; open?: (answer: ReferencesAnswer) => void }
const pending = new Map<string, Pending>();
// - each cell's note, from its last lookup: a jump that lands nowhere notes it in the cell that asked
const notes = new Map<string, (text: string) => void>();
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
      window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: only.cellId, line: only.line, col: only.col, from: r.cellNodeId } }));
      return;
    }
    vscodePostMessage({ type: 'showDefinitions', targets: r.targets, cellNodeId: r.cellNodeId });
  });
  window.addEventListener('skena:referencesResult', (e: Event) => {
    const r = (e as CustomEvent<MsgReferencesResult>).detail;
    const p = pending.get(r.cellNodeId);
    if (!p || p.reqId !== r.reqId) return;
    pending.delete(r.cellNodeId);
    if (p.stale) return;
    if (r.error !== undefined) { p.note(`references failed: ${r.error}`); return; }
    if (r.targets.length === 0) { p.note(`no references found for ${p.name}`); return; }
    p.open?.(r);
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
  notes.set(cellId, note);
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note });
  vscodePostMessage({ type: 'goToDefinition', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column, name: at.dotted });
}

/** - leader z in `cellId`'s editor: ask the host for every reference of the name under the cursor; `open` shows them */
export function requestReferences(editor: MonacoEditor.IStandaloneCodeEditor, cellId: string, note: (text: string) => void, open: (answer: ReferencesAnswer) => void): void {
  listen();
  const pos = editor.getPosition();
  const model = editor.getModel();
  if (!pos || !model) return;
  const at = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column);
  if (!at) return;
  const reqId = `ref-${++counter}`;
  notes.set(cellId, note);
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note, open });
  vscodePostMessage({ type: 'findReferences', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column });
}

/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
export function dropLookup(cellId: string, when: number): void {
  const p = pending.get(cellId);
  if (p && when > p.since) p.stale = true;
}

/** - a line in `cellId`'s note, the cell a lookup was asked in (nothing when it never asked) */
export function noteInCell(cellId: string, text: string): void {
  notes.get(cellId)?.(text);
}
