/**
 * Kernel-powered completion for code cells. Registers ONE Monaco completion provider
 * for 'python'; on trigger it asks the host to run a Jupyter complete_request against
 * the focused cell's bound kernel and turns the matches into completion items.
 *
 * The provider is global per Monaco, so the focused cell's id is tracked in a module
 * variable (set on editor focus) to resolve which kernel to complete against.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { MsgCompleteResult, MsgInspectResult } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

let registered = false;
let activeCellId: string | null = null;
let reqCounter = 0;
const pending = new Map<string, (r: MsgCompleteResult) => void>();
const pendingInspect = new Map<string, (r: MsgInspectResult) => void>();

export function setActiveCodeCell(id: string | null): void {
  activeCellId = id;
}

// - strip ANSI colour codes IPython embeds in inspect text
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

// - pull the (possibly multi-line) signature out of IPython inspect text and flatten it
// - to one line. The block runs from the "Signature:" header to the next section header
// - (Docstring:/Type:/File:...) which sit at column 0; wrapped param lines are indented.
function extractSignature(text: string): string | null {
  const lines = stripAnsi(text).split('\n');
  let started = false;
  const parts: string[] = [];
  for (const line of lines) {
    if (!started) {
      const m = line.match(/^(?:Init |Call )?[Ss]ignature:\s*(.*)$/);
      if (m) { started = true; if (m[1].trim()) parts.push(m[1].trim()); }
      continue;
    }
    if (/^[A-Z][A-Za-z ]*:/.test(line)) break;   // - next section header -> signature ended
    parts.push(line.trim());
  }
  if (!started) return null;
  const sig = parts.join(' ').replace(/\s+/g, ' ').trim();
  return sig || null;
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

function requestInspect(cellId: string, code: string, cursorPos: number): Promise<MsgInspectResult> {
  return new Promise(resolve => {
    const reqId = `insp-${++reqCounter}`;
    pendingInspect.set(reqId, resolve);
    vscodePostMessage({ type: 'inspect', reqId, cellNodeId: cellId, code, cursorPos });
    setTimeout(() => {
      const r = pendingInspect.get(reqId);
      if (r) { pendingInspect.delete(reqId); r({ type: 'inspectResult', reqId, found: false, text: '' }); }
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
  window.addEventListener('skena:inspectResult', (e: Event) => {
    const d = (e as CustomEvent<MsgInspectResult>).detail;
    const r = pendingInspect.get(d.reqId);
    if (r) { pendingInspect.delete(d.reqId); r(d); }
  });

  // - hover: kernel introspection (docstring + signature) for the symbol under the cursor
  monaco.languages.registerHoverProvider('python', {
    provideHover: async (model, position) => {
      if (!activeCellId) return null;
      const res = await requestInspect(activeCellId, model.getValue(), model.getOffsetAt(position));
      const text = stripAnsi(res.text).trim();
      if (!res.found || !text) return null;
      const w = model.getWordAtPosition(position);
      const range = w ? { startLineNumber: position.lineNumber, startColumn: w.startColumn, endLineNumber: position.lineNumber, endColumn: w.endColumn } : undefined;
      return { range, contents: [{ value: '```text\n' + text + '\n```' }] };
    },
  });

  // - signature help: introspect the function name just before the open paren
  monaco.languages.registerSignatureHelpProvider('python', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      if (!activeCellId) return null;
      const code = model.getValue();
      const offset = model.getOffsetAt(position);
      // - walk back over the current arg list to the opening '(' of this call
      let depth = 0, i = offset - 1;
      for (; i >= 0; i--) {
        const ch = code[i];
        if (ch === ')') depth++;
        else if (ch === '(') { if (depth === 0) break; depth--; }
      }
      if (i < 0) return null;
      const res = await requestInspect(activeCellId, code, i - 1);   // - inspect the callee name
      const sig = res.found ? extractSignature(res.text) : null;
      if (!sig) return null;
      return { value: { signatures: [{ label: sig, parameters: [] }], activeSignature: 0, activeParameter: 0 }, dispose: () => { /* noop */ } };
    },
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
