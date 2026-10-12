/**
 * Ctrl+H and Ctrl+L are left to VS Code (the user binds them to move between panels). VS Code sees a
 * key only when nothing in the webview stops it before its forwarder, a bubble-phase window keydown
 * listener, so no skena editor acts on these two and nothing around an editor stops them.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

/** - Ctrl+H or Ctrl+L with no other modifier */
export function isVsCodeKey(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
  const k = e.key.toLowerCase();
  return k === 'h' || k === 'l';
}

let released = false;

/**
 * Removes Monaco's default bindings of Ctrl+H (editor.action.startFindReplaceAction) and Ctrl+L
 * (expandLineSelection). Its keybinding service listens on each editor's container and stops a key it
 * runs a command for; with no binding it leaves the key alone. The rules are global, so once for every
 * editor. Not on macOS: there KeyMod.CtrlCmd is Cmd, and Cmd+H / Cmd+L stay as they are.
 */
export function releaseVsCodeKeys(monaco: typeof Monaco): void {
  if (released) return;
  released = true;
  if (navigator.userAgent.includes('Macintosh')) return;
  monaco.editor.addKeybindingRules([
    { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, command: '-editor.action.startFindReplaceAction' },
    { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, command: '-expandLineSelection' },
  ]);
}
