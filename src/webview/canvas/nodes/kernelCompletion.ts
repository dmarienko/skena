/**
 * Kernel-powered completion for code cells. Registers ONE Monaco completion provider
 * for 'python'; on trigger it asks the host to run a Jupyter complete_request against
 * the focused cell's bound kernel and turns the matches into completion items.
 *
 * The provider is global per Monaco, so the focused cell's id is tracked in a module
 * variable (set on editor focus) to resolve which kernel to complete against.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { MsgCompleteResult } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

let registered = false;
let activeCellId: string | null = null;
let reqCounter = 0;
const pending = new Map<string, (r: MsgCompleteResult) => void>();

export function setActiveCodeCell(id: string | null): void {
  activeCellId = id;
}

function requestComplete(cellId: string, code: string, cursorPos: number): Promise<MsgCompleteResult> {
  return new Promise(resolve => {
    const reqId = `cmpl-${++reqCounter}`;
    pending.set(reqId, resolve);
    vscodePostMessage({ type: 'complete', reqId, cellNodeId: cellId, code, cursorPos });
    // - fall back to no matches if the host/kernel never answers
    setTimeout(() => {
      const r = pending.get(reqId);
      if (r) { pending.delete(reqId); r({ type: 'completeResult', reqId, matches: [], cursorStart: cursorPos, cursorEnd: cursorPos }); }
    }, 4000);
  });
}

const PY_KEYWORDS = [
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
  'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'yield', 'lambda',
  'pass', 'global', 'nonlocal', 'assert', 'del', 'in', 'is', 'not', 'and', 'or',
  'None', 'True', 'False', 'async', 'await', 'match', 'case',
];
const PY_BUILTINS = [
  'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool',
  'enumerate', 'zip', 'map', 'filter', 'sum', 'min', 'max', 'sorted', 'reversed', 'open',
  'type', 'isinstance', 'issubclass', 'super', 'property', 'staticmethod', 'classmethod',
  'abs', 'round', 'any', 'all', 'input', 'format', 'repr', 'hasattr', 'getattr', 'setattr',
  'id', 'vars', 'dir', 'help', 'iter', 'next', 'bytes', 'frozenset', 'complex', 'divmod',
];

export function ensureKernelCompletion(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  window.addEventListener('skena:completeResult', (e: Event) => {
    const d = (e as CustomEvent<MsgCompleteResult>).detail;
    const r = pending.get(d.reqId);
    if (r) { pending.delete(d.reqId); r(d); }
  });

  // - static keywords + builtins so def/print/if/… complete even with no kernel bound
  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems: (model, position) => {
      const w = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber, startColumn: w.startColumn,
        endLineNumber:   position.lineNumber, endColumn:   w.endColumn,
      };
      const kw = PY_KEYWORDS.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Keyword,  insertText: k, range }));
      const bi = PY_BUILTINS.map(b => ({ label: b, kind: monaco.languages.CompletionItemKind.Function, insertText: b, range }));
      return { suggestions: [...kw, ...bi] };
    },
  });

  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    provideCompletionItems: async (model, position) => {
      if (!activeCellId) return { suggestions: [] };
      const code = model.getValue();
      const cursorPos = model.getOffsetAt(position);
      const res = await requestComplete(activeCellId, code, cursorPos);
      if (!res.matches.length) return { suggestions: [] };
      // - Jupyter returns [cursorStart, cursorEnd] as the range each match replaces
      const start = model.getPositionAt(res.cursorStart);
      const end   = model.getPositionAt(res.cursorEnd);
      const range: Monaco.IRange = {
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber:   end.lineNumber,   endColumn:   end.column,
      };
      return {
        suggestions: res.matches.map(m => ({
          label:      m,
          kind:       monaco.languages.CompletionItemKind.Variable,
          insertText: m,
          range,
        })),
      };
    },
  });
}
