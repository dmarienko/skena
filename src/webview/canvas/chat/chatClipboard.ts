// - vim clipboard relay for the chat input. The webview blocks navigator.clipboard, so vim's +, * and
// - unnamed registers go through the extension host. TextNode has its own relay; the vim register
// - controller uses whichever registered last, so the chat input registers again on every focus.
import type { editor as MonacoEditor } from 'monaco-editor';
import { VimMode } from 'monaco-vim';
import { classifyHostText, rememberWritten, stripForHost } from '../vimClipboard';

type VimRegisterLike = {
  setText:               (text: string, linewise: boolean, blockwise?: boolean) => void;
  pushText:              (text: string, linewise: boolean) => void;
  clear:                 () => void;
  toString:              () => string;
  linewise:              boolean;
  blockwise:             boolean;
  keyBuffer:             string[];
  insertModeChanges:     unknown[];
  searchQueries:         string[];
  pushInsertModeChanges?:(changes: unknown) => void;
  pushSearchQuery?:      (query: string)   => void;
};

type VimSingleton = {
  defineRegister:        (n: string, r: unknown) => void;
  getRegisterController: () => { registers: Record<string, VimRegisterLike>; unnamedRegister: VimRegisterLike };
};

let chatClipboardCache: { text: string; linewise: boolean } = { text: '', linewise: false };

export function vscodePostMessage(msg: unknown): void {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function setChatClipboardCache(text: string, linewise: boolean): void {
  chatClipboardCache = { text, linewise };
}

// - `full` is the register form; `out` replaces what the host gets (Ctrl+C sends the line verbatim)
export function writeChatClipboard(full: string, linewise: boolean, out?: string): void {
  const sent = out ?? stripForHost(full, linewise);
  rememberWritten(sent, full, linewise);
  vscodePostMessage({ type: 'writeClipboard', text: sent });
}

const chatSysReg: VimRegisterLike = {
  keyBuffer:         [''],
  linewise:          false,
  blockwise:         false,
  insertModeChanges: [],
  searchQueries:     [],

  setText(text: string, linewise: boolean, blockwise?: boolean) {
    const full = text ?? '';
    this.keyBuffer = [full];
    this.linewise  = !!linewise;
    this.blockwise = !!blockwise;
    chatClipboardCache = { text: full, linewise: !!linewise };
    writeChatClipboard(full, !!linewise);
  },
  pushText(text: string, linewise: boolean) {
    if (linewise) {
      if (!this.linewise) this.keyBuffer.push('\n');
      this.linewise = true;
    }
    this.keyBuffer.push(text);
    const full = this.keyBuffer.join('');
    chatClipboardCache = { text: full, linewise: this.linewise };
    writeChatClipboard(full, this.linewise);
  },
  clear() {
    this.keyBuffer         = [];
    this.linewise          = false;
    this.blockwise         = false;
    this.insertModeChanges = [];
    this.searchQueries     = [];
  },
  toString() {
    return chatClipboardCache.text !== '' ? chatClipboardCache.text : this.keyBuffer.join('');
  },
  pushInsertModeChanges(changes: unknown) { this.insertModeChanges.push(changes); },
  pushSearchQuery(query: string)          { this.searchQueries.push(query); },
};

// - the host clipboard text becomes the relay register; the record shared with the node relay keeps
// - the linewise flag of a yank made in a cell
export function noteChatHostClipboard(text: string): void {
  const got            = classifyHostText(text);
  chatClipboardCache   = got;
  chatSysReg.linewise  = got.linewise;
  chatSysReg.keyBuffer = [got.text];
}

function getChatVimSingleton(): VimSingleton | undefined {
  return (VimMode as unknown as Record<string, unknown>).Vim as VimSingleton | undefined;
}

// - vim `o`/`O`: monaco-vim's newlineAndIndent defers editor.action.insertLineAfter, which does not run
// - from inside a vim key handler; insert the newline synchronously. Call after every initVimMode,
// - which can rebuild the command table.
export function patchVimNewlineAndIndent(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CM = VimMode as any;
  if (!CM?.commands) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CM.commands.newlineAndIndent = function(cm: any) {
    const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
    const pos = editor.getPosition();
    if (!pos) return;
    editor.executeEdits('vim-o', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: '\n',
    }]);
  };
}

export function applyVimClipboard(): void {
  const Vim = getChatVimSingleton();
  if (!Vim) return;
  try { Vim.defineRegister('+', chatSysReg); } catch { /* already defined */ }
  try { Vim.defineRegister('*', chatSysReg); } catch { /* already defined */ }
  const rc = Vim.getRegisterController();
  if (rc) {
    rc.registers['"']  = chatSysReg;
    rc.unnamedRegister = chatSysReg;
  }
}
