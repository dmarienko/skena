import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode } from 'monaco-vim';
import { patchVimDeleteLastLine, patchVimExternalSelection, patchVimLastLine, patchVimVisualCursor } from '../nodes/TextNode';
import {
  applyVimClipboard, noteChatHostClipboard, patchVimNewlineAndIndent, setChatClipboardCache, vscodePostMessage, writeChatClipboard,
} from './chatClipboard';
import { INPUT_LINE_H, inputHeight } from './consoleLayout';

export interface ChatInputHandle {
  focus:  () => void;
  submit: () => void;
}

interface Props {
  // - the conversation's scroll box; Shift+H/J/K/L scroll it from vim normal mode
  scrollTarget:  RefObject<HTMLDivElement>;
  // - a turn is running: Ctrl+Enter sends nothing and the text stays; the harness refuses a second prompt
  working:       boolean;
  onSend:        (text: string) => void;
  onEmptyChange: (empty: boolean) => void;
}

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(props, ref) {
  const editorRef          = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const vimRef             = useRef<{ dispose: () => void } | null>(null);
  const pendingPasteRef    = useRef(false);
  const vimModeRef         = useRef('normal');
  // - the input had focus when focus left the webview; give it back when the webview returns
  const restoreOnReturnRef = useRef(false);
  // - listeners are registered once; they read the latest props from here
  const propsRef           = useRef(props);
  propsRef.current         = props;
  const [lines, setLines]  = useState(1);
  const [empty, setEmpty]  = useState(true);

  const submit = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || propsRef.current.working) return;
    const text = ed.getValue().trim();
    if (!text) return;
    propsRef.current.onSend(text);
    ed.setValue('');
    ed.focus();
  }, []);

  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus(), submit }), [submit]);

  // - host clipboard text: refreshes the vim register and completes a pending Ctrl+V
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? '';
      noteChatHostClipboard(text);
      if (!pendingPasteRef.current) return;
      pendingPasteRef.current = false;
      const ed  = editorRef.current;
      const sel = ed?.getSelection();
      if (!ed || !sel) return;
      ed.executeEdits('system-paste', [{ range: sel, text, forceMoveMarkers: true }]);
      ed.focus();
    };
    window.addEventListener('skena:clipboardContent', handler);
    return () => window.removeEventListener('skena:clipboardContent', handler);
  }, []);

  // - Ctrl+Enter in the capture phase: Monaco's addCommand drops other bindings once Ctrl+V and Ctrl+C are bound
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      submit();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [submit]);

  // - Alt+I moves focus between the input and the canvas; the capture phase runs before Monaco
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key.toLowerCase() !== 'i') return;
      e.preventDefault();
      e.stopPropagation();
      const ed = editorRef.current;
      if (ed?.hasTextFocus()) {
        (document.activeElement as HTMLElement | null)?.blur();
        window.dispatchEvent(new CustomEvent('skena:restoreCanvasFocus'));
      } else {
        ed?.focus();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - back from another VS Code panel: panelActivated covers other editor groups; window focus covers the
  // - sidebar and terminal, where the canvas stays the active editor and panelActivated never fires
  useEffect(() => {
    const restore = () => {
      if (!restoreOnReturnRef.current) return;
      restoreOnReturnRef.current = false;
      requestAnimationFrame(() => editorRef.current?.focus());
    };
    const onWinFocus = () => {
      if (!restoreOnReturnRef.current) return;
      // - window focus fires in short-lived pairs; act only if the focus is still here a tick later
      setTimeout(() => { if (document.hasFocus()) restore(); }, 0);
    };
    window.addEventListener('skena:panelActivated', restore);
    window.addEventListener('focus', onWinFocus);
    return () => {
      window.removeEventListener('skena:panelActivated', restore);
      window.removeEventListener('focus', onWinFocus);
    };
  }, []);

  // - Monaco binds Alt+L to find-in-selection and swallows it; send VS Code's navigateRight instead
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      vscodePostMessage({ type: 'navigateFocus', dir: 'right' });
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - Shift+H/J/K/L scroll the conversation from vim normal mode; the capture phase runs before vim's J/H/L
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['H', 'J', 'K', 'L'].includes(e.key)) return;
      if (!editorRef.current?.hasTextFocus() || vimModeRef.current !== 'normal') return;
      const el = propsRef.current.scrollTarget.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const vStep = 60;
      const hStep = 120;
      switch (e.key) {
        case 'J': el.scrollBy({ top:  vStep, behavior: 'smooth' }); break;
        case 'K': el.scrollBy({ top: -vStep, behavior: 'smooth' }); break;
        case 'L': el.scrollBy({ left:  hStep, behavior: 'smooth' }); break;
        case 'H': el.scrollBy({ left: -hStep, behavior: 'smooth' }); break;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - Monaco themes are global: keep the same 'skena-editor' definition the node editors use;
  // - the see-through background comes from chat-console.css
  const handleBeforeMount: BeforeMount = useCallback((monacoInstance) => {
    const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    monacoInstance.editor.defineTheme('skena-editor', {
      base:    'vs-dark',
      inherit: true,
      rules:   [],
      colors: {
        'editor.background':               bg || '#1e1e2e',
        'editor.lineHighlightBackground':  '#00000000',
        'editor.lineHighlightBorderColor': '#00000000',
        'editorCursor.foreground':         '#f01010',
      },
    });
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    editor.updateOptions({
      minimap:              { enabled: false },
      lineNumbers:          'off',
      glyphMargin:          false,
      folding:              false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars:  0,
      overviewRulerLanes:   0,
      scrollBeyondLastLine: false,
      wordWrap:             'on',
      // - useShadows draws an inset shadow on the scrolled-past edge; off, since the bar has no header to shadow under
      scrollbar:            { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: false, verticalScrollbarSize: 3, useShadows: false },
      // - no padding: the content height is then exactly lines × INPUT_LINE_H
      padding:              { top: 0, bottom: 0 },
    });
    editor.onDidContentSizeChange(e => setLines(e.contentHeight / INPUT_LINE_H));
    editor.onDidChangeModelContent(() => {
      const isEmpty = editor.getValue().trim() === '';
      setEmpty(isEmpty);
      propsRef.current.onEmptyChange(isEmpty);
    });

    vimRef.current = initVimMode(editor, null) as { dispose: () => void };
    // - track the vim mode so Shift+H/J/K/L scroll only outside insert mode
    (vimRef.current as unknown as { on?: (ev: string, cb: (e: { mode: string }) => void) => void })
      .on?.('vim-mode-change', ev => { vimModeRef.current = ev.mode; });
    patchVimNewlineAndIndent();
    patchVimLastLine();
    patchVimVisualCursor();
    patchVimExternalSelection();
    patchVimDeleteLastLine();
    applyVimClipboard();

    editor.onDidFocusEditorText(() => {
      // - a node editor may have taken the vim registers while it had focus; take them back
      applyVimClipboard();
      vscodePostMessage({ type: 'requestClipboardRead' });
    });
    editor.onDidBlurEditorText(() => {
      // - document.hasFocus() still reads the old value during blur; read it a tick later
      setTimeout(() => { restoreOnReturnRef.current = !document.hasFocus(); }, 0);
    });

    // - Ctrl+V outside vim normal mode pastes the host clipboard; navigator.clipboard is blocked here
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
      pendingPasteRef.current = true;
      vscodePostMessage({ type: 'requestClipboardRead' });
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
      const sel   = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model) return;
      const text = sel.isEmpty() ? model.getLineContent(sel.startLineNumber) + '\n' : model.getValueInRange(sel);
      if (!text) return;
      setChatClipboardCache(text, sel.isEmpty());
      // - a whole-line copy keeps its trailing newline on the host, as VS Code's own Ctrl+C does
      writeChatClipboard(text, sel.isEmpty(), text);
    });
  }, []);

  useEffect(() => () => { vimRef.current?.dispose(); }, []);

  return (
    <div className="cc-editor">
      {empty && <span className="cc-ph">Ask the agent</span>}
      <Editor
        height={inputHeight(lines)}
        defaultLanguage="markdown"
        theme="skena-editor"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          fontSize:            13,
          lineHeight:          INPUT_LINE_H,
          fontFamily:          MONO,
          suggest:             { showWords: false },
          quickSuggestions:    false,
          parameterHints:      { enabled: false },
          renderLineHighlight: 'none',
          automaticLayout:     true,
          cursorWidth:         3,
        }}
      />
    </div>
  );
});
