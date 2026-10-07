/**
 * Find references in a code cell (leader z), shown as Monaco's own reference peek inside the cell's
 * editor. The bundle already holds the peek: basic-languages/_.contribution.js (imported through
 * python.contribution.js in index.tsx) imports goToCommands.js and standaloneReferenceSearch.js.
 *
 * The host's answer becomes, for the time the peek is open: a model per other cell and per file (the
 * peek previews and lists them through the text model service, which only finds existing models), a
 * reference provider for this editor's model that returns the answer, and the cell drawn taller
 * (setHeight). Then editor.action.referenceSearch.trigger opens the peek. In its list j/k move and
 * preview, l/h open and close groups, Enter goes to the place, Esc closes it (Monaco's
 * closeReferenceSearch); its preview is read-only. Going to a place
 * passes through the editor opener below, which goes there as go to definition does. However the peek
 * closes, finish() undoes the rest.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { editor as MonacoEditor } from 'monaco-editor';
import { openedTarget, peekPlan, type PeekPlan, type ReferencesAnswer } from '../../../shared/findReferences';
import type { DefinitionTarget } from '../../../shared/goToDefinition';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - ReferencesController (referencesController.js): its id, and closeWidget, a public method of the class
const CONTROLLER = 'editor.contrib.referencesController';
type ReferencesController = MonacoEditor.IEditorContribution & { closeWidget(focusEditor?: boolean): void };
// - the class of the peek's container (referencesWidget.js _fillBody) and of its list (div.ref-tree)
const PEEK = '.reference-zone-widget';
const LIST = `${PEEK} .ref-tree`;

interface Peek {
  plan:   PeekPlan;
  /** - the cell the peek is open in */
  cellId: string;
  finish: (restore: boolean) => void;
}
const peeks = new Map<MonacoEditor.ICodeEditor, Peek>();

// - keys this module sends to the peek's list; its own key listener lets them through
const sent = new WeakSet<Event>();

type ListKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Enter';

// - j/k/l/h in the peek's list, as the arrow and its key code: down and up move (listWidget.js
//   KeyboardController); right opens a closed group or moves into an open one, left closes an open
//   group or moves from a reference to its group (abstractTree.js onRightArrow, onLeftArrow)
const ARROWS: Record<string, [ListKey, number]> = { j: ['ArrowDown', 40], k: ['ArrowUp', 38], l: ['ArrowRight', 39], h: ['ArrowLeft', 37] };

// - a key as the list reads it: Monaco takes the key code from keyCode (keyboardEvent.js
//   extractKeyCode), which a KeyboardEvent cannot be constructed with
function press(target: EventTarget, key: ListKey, keyCode: number): void {
  const e = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => keyCode });
  sent.add(e);
  target.dispatchEvent(e);
}

// - `from`: the cell the peek was open in, where a note goes when the target cell is gone
function goTo(t: DefinitionTarget, from: string): void {
  if (t.kind === 'cell') window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: t.cellId, line: t.line, col: t.col, from } }));
  else vscodePostMessage({ type: 'showDefinitions', targets: [t], cellNodeId: from });
}

let openerInstalled = false;

// - Monaco opens a reference (Enter, a double-click) through the code editor service, with the editor
//   the peek is in as source; openers registered later are asked first (abstractCodeEditorService.js)
function installOpener(): void {
  if (openerInstalled) return;
  openerInstalled = true;
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, at) {
      const peek = peeks.get(source);
      if (!peek) return false;
      const pos = at === undefined ? { lineNumber: 1, column: 1 } : 'startLineNumber' in at ? { lineNumber: at.startLineNumber, column: at.startColumn } : at;
      const target = openedTarget(peek.plan, resource.toString(), pos.lineNumber, pos.column);
      if (!target) return false;
      peek.finish(true);
      goTo(target, peek.cellId);
      return true;
    },
  });
}

/** - this editor's peek is open */
export function referencePeekOpen(editor: MonacoEditor.ICodeEditor): boolean {
  return peeks.has(editor);
}

/** - closes this editor's peek; false when none is open */
export function closeReferencePeek(editor: MonacoEditor.ICodeEditor): boolean {
  const peek = peeks.get(editor);
  peek?.finish(true);
  return peek !== undefined;
}

/**
 * Opens Monaco's reference peek in `editor` (cell `cellId`) on the host's answer. `height` is the cell's
 * height while it is open (null: its own), and `setHeight` draws the cell at a height and returns once
 * the editor has the new size: Monaco sizes the peek from the editor's height when it opens.
 */
export function openReferencePeek(
  editor: MonacoEditor.IStandaloneCodeEditor,
  cellId: string,
  answer: ReferencesAnswer,
  height: number | null,
  setHeight: (px: number | null) => void,
): void {
  installOpener();
  closeReferencePeek(editor);
  const model = editor.getModel();
  const dom = editor.getDomNode();
  if (!model || !dom) return;
  const raw = peekPlan(answer, cellId, model.uri.toString());
  // - the URIs as Monaco writes them, so the opener finds the ones it is handed
  const norm = (u: string) => monaco.Uri.parse(u).toString();
  const plan: PeekPlan = {
    ...raw,
    owners: Object.fromEntries(Object.entries(raw.owners).map(([u, o]) => [norm(u), o])),
  };
  const models = plan.models.map(m => {
    const uri = monaco.Uri.parse(m.uri);
    monaco.editor.getModel(uri)?.dispose();
    return monaco.editor.createModel(m.text, m.language, uri);
  });
  const locations = plan.locations.map(l => ({ uri: monaco.Uri.parse(l.uri), range: l.range }));
  const own = model.uri.toString();
  // - only while the peek is open: whenever a provider exists Monaco offers Go to References and Peek in
  //   the editor's context menu (goToCommands.js)
  const provider = monaco.languages.registerReferenceProvider({ language: 'python', scheme: model.uri.scheme }, {
    provideReferences: m => (m.uri.toString() === own ? locations : []),
  });

  const container = editor.getContainerDomNode();
  // - in the peek's list: j/k move, l/h open and close groups (each an arrow, then Enter, which selects
  //   and so previews, as VS Code's list keys do with selectionNavigation; Enter on a group does nothing,
  //   referencesWidget.js onEvent) and Enter goes to the place. Esc goes on to the peek, which closes on
  //   it (referencesWidget.js, closeReferenceSearch). At capture on the editor's container, so neither
  //   the list (its type-to-find) nor anything above it (the canvas's h/j/k/l) sees j, k, l, h or Enter.
  const onKey = (e: KeyboardEvent) => {
    if (sent.has(e) || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Element) || !e.target.closest(LIST)) return;
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      e.stopPropagation();
      press(e.target, arrow[0], arrow[1]);
      press(e.target, 'Enter', 13);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // - referencesController.js openReference: closes the peek, then opens the focused reference
      editor.trigger('skena', 'openReference', null);
    }
  };
  container.addEventListener('keydown', onKey, { capture: true });

  const isOpen = () => dom.querySelector(PEEK) !== null;
  let seen = false;
  let done = false;
  const finish = (restore: boolean) => {
    if (done) return;
    done = true;
    peeks.delete(editor);
    observer.disconnect();
    disposed.dispose();
    container.removeEventListener('keydown', onKey, { capture: true });
    if (restore) {
      // - also when the peek is only hidden: a double-click hides it before it opens the reference, and
      //   shows it again afterwards if it is still there (referencesController.js _gotoReference)
      editor.getContribution<ReferencesController>(CONTROLLER)?.closeWidget(false);
      setHeight(null);
    }
    provider.dispose();
    models.forEach(m => m.dispose());
  };
  // - the peek is an overlay widget of the editor (zoneWidget.js addOverlayWidget): one child of
  //   .overlayWidgets while it is open
  const observer = new MutationObserver(() => {
    if (!isOpen()) { if (seen) finish(true); return; }
    if (seen) return;
    seen = true;
    // - the preview is an editor of its own (referencesWidget.js, an EmbeddedCodeEditorWidget, which
    //   getEditors lists); a copy of another cell or a file is saved nowhere, so it is read-only, and the
    //   cell's own editor stays editable. Its updateOptions keeps readOnly when the cell's editor changes
    //   its options, a layout included (embeddedCodeEditorWidget.js _onParentConfigurationChanged)
    for (const e of monaco.editor.getEditors()) if (e !== editor && dom.contains(e.getContainerDomNode())) e.updateOptions({ readOnly: true });
  });
  const overlays = dom.querySelector('.overlayWidgets');
  if (overlays) observer.observe(overlays, { childList: true });
  // - the editor goes (the cell left edit mode): the peek went with it, the cell keeps its own size
  const disposed = editor.onDidDispose(() => finish(false));
  peeks.set(editor, { plan, cellId, finish });

  if (height !== null) setHeight(height);
  editor.trigger('skena', 'editor.action.referenceSearch.trigger', null);
  // - Monaco opens the peek in promise callbacks of the trigger; when there is none by the next task, none is coming
  setTimeout(() => { if (!seen) finish(true); }, 0);
}
