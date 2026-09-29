/**
 * CodeNode — editable code cell that runs on a bound kernel node.
 * Header has a Run button + status glyph; body is a Monaco (python) editor.
 * Run is disabled until the cell is connected to a kernel node (see kernelBinding).
 */

import React, { useCallback, useState, useEffect, useLayoutEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, Handle, Position, NodeResizer, useStore, type Node as RFNode, type Edge } from '@xyflow/react';
import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { initVimMode } from 'monaco-vim';
import { CodeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';
import { makeCellKernelResolver } from '../../../shared/kernelBinding';
import type { SectionLane } from '../../../shared/sectionLanes';
import type { KernelRecord } from '../../../shared/types';
import { useLanes } from '../LanesContext';
import { useKernels } from '../KernelsContext';
import { cachedHighlight, highlightCode } from '../../renderers/CodeRenderer';
import { G_BADGES_ATTR } from '../gChord';
import { ScrollableContent, setScrollPosition } from '../../components/ScrollableContent';
import { applyVimClipboard, patchVimNewlineAndIndent, patchVimLastLine, patchVimBlockCursorBlink, patchVimVisualCursor, patchVimExternalSelection, patchVimDeleteLastLine, patchVimJoin, bindSuggestNav } from './TextNode';
import { ensureKernelCompletion, setActiveCodeCell } from './kernelCompletion';
import { CodeCellPreview, codeCellLines, firstGlyphRect, previewLineRects, textContentRect, type CodeCellFont } from './CodeCellPreview';
import { codeGutter, LINE_DECORATIONS_WIDTH, LINE_NUMBERS_MIN_CHARS, LINE_NUMBER_ACTIVE_COLOR, LINE_NUMBER_COLOR } from '../codeCellView';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - the editor options that decide where Monaco draws the line numbers and the first code glyph; the
// - preview's line-number column is computed from the same values (codeGutter)
function cellEditorLayout(font: CodeCellFont): MonacoEditor.IStandaloneEditorConstructionOptions {
  return {
    fontFamily:           font.family,
    fontSize:             font.size,
    fontLigatures:        true,   // - Monaco defaults OFF; enable so ligature/Nerd-Font glyphs match the preview
    lineHeight:           font.lineHeight,   // - explicit px so it matches the preview exactly
    lineNumbers:          'relative',
    lineNumbersMinChars:  LINE_NUMBERS_MIN_CHARS,
    lineDecorationsWidth: LINE_DECORATIONS_WIDTH,
    folding:              false,
    glyphMargin:          false,
  };
}

// - Monaco's width of the widest digit in the cell font, read once from a throwaway editor so the
// - preview's line-number column uses the number Monaco lays its own out with, before any cell is opened.
// - A cell's editor overwrites it with its own reading (rememberDigitWidth), in case fonts loaded since.
let digitWidthCache: { key: string; width: number } | null = null;
function fontKey(font: CodeCellFont): string {
  return `${font.family}|${font.size}|${font.lineHeight}`;
}
function rememberDigitWidth(font: CodeCellFont, width: number): void {
  digitWidthCache = { key: fontKey(font), width };
}
function monacoMaxDigitWidth(font: CodeCellFont): number {
  const key = fontKey(font);
  if (digitWidthCache?.key === key) return digitWidthCache.width;
  let width = font.size * 0.6;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:200px;height:60px;visibility:hidden';
  document.body.appendChild(host);
  try {
    const ed = monaco.editor.create(host, { ...cellEditorLayout(font), value: '', minimap: { enabled: false } });
    width = ed.getOption(monaco.editor.EditorOption.fontInfo).maxDigitWidth;
    const model = ed.getModel();
    ed.dispose();
    model?.dispose();
  } catch (err) {
    console.warn('[skena] could not measure the code cell font, line numbers may be off by a few px', err);
  }
  host.remove();
  digitWidthCache = { key, width };
  return width;
}

// - flip with localStorage.setItem('skena.debugCodeSwap', '1') in the webview devtools — no rebuild
function debugCodeSwap(): boolean {
  return localStorage.getItem('skena.debugCodeSwap') === '1';
}

// - 0-based index of the first line with a non-blank character: the line whose glyph and number are logged
function firstCodeLine(code: string): number {
  return Math.max(0, codeCellLines(code).findIndex(l => /\S/.test(l)));
}

function nearestByTop(root: Element, selector: string, top: number): Element | null {
  let best: Element | null = null;
  let bestD = Infinity;
  for (const el of Array.from(root.querySelectorAll(selector))) {
    const d = Math.abs(el.getBoundingClientRect().top - top);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}

// - screen rects of the first code glyph and of the line number on 0-based `line` of the editor, and the
// - canvas zoom (screen px per editor px)
function editorLineRects(ed: MonacoEditor.IStandaloneCodeEditor, line: number): { glyph: DOMRect | null; number: DOMRect | null; zoom: number } {
  const dom = ed.getDomNode();
  const pos = ed.getScrolledVisiblePosition({ lineNumber: line + 1, column: 1 });
  if (!dom || !pos) return { glyph: null, number: null, zoom: 1 };
  const box = dom.getBoundingClientRect();
  const zoom = dom.offsetWidth > 0 ? box.width / dom.offsetWidth : 1;
  const top = box.top + pos.top * zoom;
  const viewLine = nearestByTop(dom, '.view-lines .view-line', top);
  const num = nearestByTop(dom, '.margin-view-overlays .line-numbers', top);
  return { glyph: viewLine ? firstGlyphRect(viewLine) : null, number: num ? textContentRect(num) : null, zoom };
}

type LineRects = { glyph: DOMRect | null; number: DOMRect | null };

// - enter: measured just before the preview is taken away. leave: the editor measured just before it
// - goes; the preview is measured once it is back.
type SwapLog =
  | { direction: 'enter'; report: Record<string, unknown> }
  | { direction: 'leave'; line: number; leftAt: number; zoom: number; editor: LineRects };

function swapReport(preview: LineRects, editor: LineRects): Record<string, unknown> {
  const pt = (r: DOMRect | null) => r && { x: +r.left.toFixed(2), y: +r.top.toFixed(2) };
  const d = (a: DOMRect | null, b: DOMRect | null) => a && b ? { dx: +(a.left - b.left).toFixed(2), dy: +(a.top - b.top).toFixed(2) } : null;
  return {
    preview: { glyph: pt(preview.glyph), number: pt(preview.number) },
    editor:  { glyph: pt(editor.glyph),  number: pt(editor.number) },
    // - editor minus preview, in screen px
    glyphShift:  d(editor.glyph, preview.glyph),
    numberShift: d(editor.number, preview.number),
  };
}

// - Monaco overflow widgets (suggest/hover/signature) render with position:fixed. React
// - Flow's viewport transform would make "fixed" relative to the zoomed pane, hiding them
// - off-screen — so anchor them to a body-level container that has no transformed ancestor.
function overflowWidgetsRoot(): HTMLElement {
  let el = document.getElementById('skena-monaco-overflow');
  if (!el) {
    el = document.createElement('div');
    el.id = 'skena-monaco-overflow';
    el.className = 'monaco-editor';   // - Monaco styles its widgets under this class
    el.style.position = 'absolute';
    el.style.zIndex = '2000';
    document.body.appendChild(el);
  }
  return el;
}

// - one resolver per store snapshot: this selector runs once per code node per store change, so the
//   node index is built once and shared instead of once per node
let resolverKey: { nodes: unknown; edges: unknown; lanes: unknown; kernels: unknown } | null = null;
let resolverFn: ((cellId: string) => string | null) | null = null;
function cellKernelResolver(nodes: RFNode[], edges: Edge[], lanes: SectionLane[], kernels: KernelRecord[]): (cellId: string) => string | null {
  if (!resolverFn || !resolverKey || resolverKey.nodes !== nodes || resolverKey.edges !== edges || resolverKey.lanes !== lanes || resolverKey.kernels !== kernels) {
    resolverFn = makeCellKernelResolver({
      nodes:    nodes.map(n => ({ id: n.id, type: n.type ?? '', y: n.position.y, x: n.position.x })),
      edges:    edges.map(e => ({ fromNode: e.source, toNode: e.target })),
      sections: lanes,
      kernels,
    });
    resolverKey = { nodes, edges, lanes, kernels };
  }
  return resolverFn;
}

function CodeNodeInner({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CodeNode & { accentColor?: string };
  const bw = useZoomInvariantBorderWidth(1.5);
  const selectedStyle = useSelectedStyle(selected);
  const borderColor = nodeBorderColor('code', node.accentColor);
  const [code, setCode] = useState(node.code ?? '');
  // - editing: the editor is mounted. editorShown: it has tokenized and painted its lines, so the
  // - preview laid over it until then can go
  const [editing, setEditing] = useState(false);
  const [editorShown, setEditorShown] = useState(false);
  // - use the VS Code editor font (family + size) so the Monaco editor matches the
  // - preview. These vars ARE injected into webviews (unlike the editor colour vars).
  const editorFont = useMemo<CodeCellFont>(() => {
    const cs = getComputedStyle(document.body);
    const family = cs.getPropertyValue('--vscode-editor-font-family').trim() || 'monospace';
    const size   = parseInt(cs.getPropertyValue('--vscode-editor-font-size'), 10) || 12;
    // - explicit px line height (Monaco rounds a <8 multiplier to px). Use the SAME px for
    // - the editor and the preview so preview<->edit don't grow.
    const lineHeight = Math.round(size * 1.3);
    return { family, size, lineHeight };
  }, []);
  const maxDigitWidth = monacoMaxDigitWidth(editorFont);
  const language = node.language ?? 'python';
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);
  // - when the current open started (performance.now()), for the debug log
  const enterAtRef = useRef(0);
  const startEdit = useCallback(() => {
    setEditing(prev => {
      if (!prev) enterAtRef.current = performance.now();
      return true;
    });
  }, []);

  // - re-sync from an external write (MCP / disk reload) — React Flow keeps this
  // - instance by id, so a changed data.code prop would otherwise leave `code` stale.
  useEffect(() => { setCode(node.code ?? ''); }, [node.code]);

  const lanes = useLanes();
  const kernelsCtx = useKernels();
  // - selector returns a primitive (kernel id | null), so default Object.is equality is safe
  const bound = useStore(s => cellKernelResolver(s.nodes, s.edges, lanes, kernelsCtx)(id));

  const run = useCallback(() => {
    if (!bound) return;
    vscodePostMessage({ type: 'runCell', cellNodeId: id, code });
  }, [bound, id, code]);

  // - addCommand captures its callback once at mount, so route through a ref
  // - kept fresh with the latest `run` (which closes over bound/code).
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);

  const isRunning = node.lastStatus === 'running';
  const isRunningRef = useRef(isRunning);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  // - interrupt (SIGINT) the kernel running this cell; the host resolves the bound kernel.
  // - `confirm` asks the host for a modal first (used by the Ctrl+C hotkey, which is easy to mishit).
  const interrupt = useCallback((confirm: boolean) => {
    vscodePostMessage({ type: 'interruptCell', cellNodeId: id, confirm });
  }, [id]);
  const interruptRef = useRef(interrupt);
  useEffect(() => { interruptRef.current = interrupt; }, [interrupt]);

  // - right-click menu (portal'd to body so React Flow's viewport transform doesn't offset it)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', onDown, { capture: true });
    return () => window.removeEventListener('mousedown', onDown, { capture: true });
  }, [menu]);
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (editing) return;   // - in edit mode let Monaco show its own context menu
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [editing]);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const nodeElRef = useRef<HTMLDivElement | null>(null);
  // - what this cell's text needs right now, in px: Monaco's content height plus the chrome around
  // - it (header, node borders, vim status bar). Both boxes are read off the live DOM on EVERY
  // - call. A chrome measured once after mount is taken before Monaco has sized itself to its
  // - flex container (automaticLayout observes asynchronously), so the editor box reads back far
  // - too short and the chrome far too tall — every cell then grew on its first keystroke. Two
  // - offsetHeight reads per keystroke cost nothing. The same expression also SHRINKS an
  // - oversized cell: fewer lines, smaller need, and the engine steps the height back down.
  const reportHeight = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const dom = ed.getDomNode();
    const box = nodeElRef.current?.closest('.react-flow__node') as HTMLElement | null;
    if (!dom || !box) return;
    const chrome = box.offsetHeight - dom.offsetHeight;
    if (dom.offsetHeight <= 0 || box.offsetHeight <= 0 || chrome <= 0) return;
    const content = ed.getContentHeight();
    const need = content + chrome;
    // - flip with localStorage.setItem('skena.debugCodeHeight', '1') in the webview devtools — no rebuild
    if (localStorage.getItem('skena.debugCodeHeight') === '1') console.debug('[skena codeHeight]', { id, box: box.offsetHeight, dom: dom.offsetHeight, content, need });
    window.dispatchEvent(new CustomEvent('skena:codeHeight', { detail: { id, height: need } }));
  }, [id]);
  // - cursor + scroll position, preserved across edit → preview → edit so re-entering
  // - the cell lands where you left off instead of at line 1
  const savedViewState = useRef<MonacoEditor.ICodeEditorViewState | null>(null);
  const magicDecoRef = useRef<string[]>([]);
  // - the preview's scroll box: the editor opens at its scroll offset so the text does not move
  const previewElRef = useRef<HTMLDivElement | null>(null);
  // - bumped by every leave request and by the editor regaining focus; a leave waiting on the
  // - highlighter goes ahead only if it is still the latest
  const leaveSeqRef = useRef(0);
  // - debug log of the current swap, finished in the layout effect below once the swap is committed
  const swapLogRef = useRef<SwapLog | null>(null);
  const onEditorMount = useCallback<OnMount>((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    const mountedAt = performance.now();
    rememberDigitWidth(editorFont, editorInstance.getOption(monacoInstance.editor.EditorOption.fontInfo).maxDigitWidth);
    // - the focused cell is the completion target (provider is global per Monaco); also refresh
    // - the clipboard cache from the host so vim `p` / Ctrl+V paste the current system clipboard
    editorInstance.onDidFocusEditorText(() => {
      leaveSeqRef.current++;
      setActiveCodeCell(id);
      vscodePostMessage({ type: 'requestClipboardRead' });
    });

    // - colour IPython magic / shell lines (%, %%, !) distinctly — they aren't valid
    // - Python so the python grammar mis-tokenises them; decorate the magic token.
    const refreshMagic = () => {
      const model = editorInstance.getModel();
      if (!model) return;
      const decos: MonacoEditor.IModelDeltaDecoration[] = [];
      for (let ln = 1; ln <= model.getLineCount(); ln++) {
        const m = model.getLineContent(ln).match(/^(\s*)(%{1,2}\s*[A-Za-z_]\w*|!)/);
        if (m) {
          const from = m[1].length + 1;
          decos.push({
            range: new monacoInstance.Range(ln, from, ln, from + m[2].length),
            options: { inlineClassName: 'skena-magic' },
          });
        }
      }
      magicDecoRef.current = editorInstance.deltaDecorations(magicDecoRef.current, decos);
    };
    editorInstance.onDidChangeModelContent(refreshMagic);
    refreshMagic();
    // - run bindings (per-instance, safe): fire from ANY vim mode and do NOT change it,
    // - so you can type in insert mode, run, and keep typing. Shift+Enter / Ctrl+Enter /
    // - Alt+R / Alt+J all run the cell.
    const bindRun = (keybinding: number) => editorInstance.addCommand(keybinding, () => runRef.current());
    bindRun(monacoInstance.KeyMod.Shift   | monacoInstance.KeyCode.Enter);
    bindRun(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter);
    bindRun(monacoInstance.KeyMod.Alt     | monacoInstance.KeyCode.KeyR);
    bindRun(monacoInstance.KeyMod.Alt     | monacoInstance.KeyCode.KeyJ);

    bindSuggestNav(editorInstance, monacoInstance);
    // - vim mode (same editor experience as text nodes); status bar shows the mode
    initVimMode(editorInstance, vimStatusRef.current ?? undefined);
    // - wire vim y/p to the host clipboard relay (webview sandbox blocks navigator.clipboard);
    // - MUST run after initVimMode (which can recreate the register controller). Also patch
    // - vim o/O newline. Both operate on monaco-vim's global singleton.
    applyVimClipboard();
    patchVimNewlineAndIndent();
    patchVimLastLine();
    patchVimBlockCursorBlink();
    patchVimVisualCursor();
    patchVimExternalSelection();
    patchVimDeleteLastLine();
    patchVimJoin(editorInstance, vimStatusRef.current);
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
    // - the preview is still on screen over the editor; start at its scroll offset (it shares the
    // - editor's font and line height, so the offsets map 1:1) so nothing moves when it goes
    const previewEl = previewElRef.current;
    if (previewEl) {
      editorInstance.setScrollTop(previewEl.scrollTop);
      editorInstance.setScrollLeft(previewEl.scrollLeft);
    }
    editorInstance.focus();

    // - take the preview away once the editor has its python tokens (colours and the bracket pairs
    // - Monaco reads from them) and has painted them. Any key, click or edit takes it away at once:
    // - from then on the editor shows something the preview does not.
    let revealed = false;
    const reveal = (by: 'painted' | 'input' | 'timeout') => {
      if (revealed || !editorInstance.getModel()) return;
      revealed = true;
      if (debugCodeSwap()) {
        const line = firstCodeLine(editorInstance.getValue());
        const lines = editorInstance.getModel()?.getLineCount() ?? 1;
        const ed = editorLineRects(editorInstance, line);
        const pv = previewElRef.current ? previewLineRects(previewElRef.current, line) : { glyph: null, number: null };
        swapLogRef.current = {
          direction: 'enter',
          report: {
            id, direction: 'enter', line, zoom: +ed.zoom.toFixed(4), revealedBy: by,
            mountMs: Math.round(mountedAt - enterAtRef.current),
            contentLeft: { preview: codeGutter(lines, monacoMaxDigitWidth(editorFont)).contentLeft, editor: editorInstance.getLayoutInfo().contentLeft },
            ...swapReport(pv, ed),
          },
        };
      }
      setEditorShown(true);
    };
    const revealOnInput = [
      editorInstance.onKeyDown(() => reveal('input')),
      editorInstance.onMouseDown(() => reveal('input')),
      editorInstance.onDidChangeModelContent(() => reveal('input')),
    ];
    // - never keep the preview up longer than this, whatever the tokenizer does
    const revealTimer = setTimeout(() => reveal('timeout'), 1000);
    editorInstance.onDidDispose(() => {
      clearTimeout(revealTimer);
      revealOnInput.forEach(d => d.dispose());
    });
    // - colorize resolves once the python tokenizer is loaded; forceTokenization (TextModel.tokenization,
    // - not in Monaco's typings) then tokenizes every line now instead of in idle time, and marks the
    // - model fully tokenized so the bracket colours switch to the token-aware ones. Two frames later
    // - Monaco has painted them.
    monacoInstance.editor.colorize('', 'python', {})
      .then(() => {
        const model = editorInstance.getModel();
        if (model) (model as unknown as { tokenization: { forceTokenization(line: number): void } }).tokenization.forceTokenization(model.getLineCount());
      })
      .catch(err => console.warn('[skena] code cell tokenization', err))
      .then(() => requestAnimationFrame(() => requestAnimationFrame(() => reveal('painted'))));

    const leaveEdit = () => {
      // - save cursor+scroll only while the editor is still alive; a disposed editor's
      // - saveViewState() returns null and would wipe the saved position (reset to line 1)
      if (!editorInstance.getModel()) return;
      const vs = editorInstance.saveViewState();
      if (vs) savedViewState.current = vs;
      // - hand the editor's scroll offset to the preview so it keeps the same visible frame
      // - (the preview shares the editor font + line-height, so scrollTop maps 1:1)
      setScrollPosition(`${id}-code`, editorInstance.getScrollTop());
      const text = editorInstance.getValue();
      const seq = ++leaveSeqRef.current;
      const leftAt = performance.now();
      // - the editor stays on screen until the preview can draw this text highlighted in its first
      // - frame; the highlighter is capped so a stuck one cannot keep the editor open
      Promise.race([
        highlightCode(text, languageRef.current).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 500)),
      ]).then(() => {
        if (seq !== leaveSeqRef.current || !editorInstance.getModel()) return;
        if (debugCodeSwap()) {
          const line = firstCodeLine(text);
          const ed = editorLineRects(editorInstance, line);
          swapLogRef.current = { direction: 'leave', line, leftAt, zoom: +ed.zoom.toFixed(4), editor: ed };
        }
        setEditing(false);
        setEditorShown(false);
      });
    };
    // - click / tab away from the editor → leave edit mode back to the preview. BUT a blur
    // - into the vim command/search prompt (`/`, `?`, `:` — monaco-vim renders it into our
    // - status bar) is still "editing"; defer so activeElement is the new target, and stay.
    // - Skip entirely if the editor was already disposed (e.g. Esc-exit already ran leaveEdit).
    editorInstance.onDidBlurEditorText(() => {
      setTimeout(() => {
        if (!editorInstance.getModel()) return;
        if (vimStatusRef.current && vimStatusRef.current.contains(document.activeElement)) return;
        leaveEdit();
      }, 0);
    });

    // - Esc exits edit mode only from vim NORMAL mode (INSERT/VISUAL just return to normal).
    // - Track the mode from the status bar; MutationObserver runs as a microtask so inside
    // - onKeyDown `vimIsEditing` still holds the pre-key state (same trick as TextNode).
    let vimIsEditing = false;
    if (vimStatusRef.current) {
      const obs = new MutationObserver(() => {
        const t = vimStatusRef.current?.textContent ?? '';
        vimIsEditing = t.includes('INSERT') || t.includes('VISUAL') || t.includes('REPLACE');
      });
      obs.observe(vimStatusRef.current, { childList: true, subtree: true, characterData: true });
      editorInstance.onDidDispose(() => obs.disconnect());
    }
    editorInstance.onKeyDown(e => {
      if (e.browserEvent.key === 'Escape' && !vimIsEditing) leaveEdit();
    });
  }, [id, editorFont]);

  // - a freshly-created code cell (autoEdit) or Enter-on-selected fires skena:enterEdit → edit mode
  useEffect(() => {
    const onEnter = (e: Event) => {
      if ((e as CustomEvent).detail?.id === id) startEdit();
    };
    window.addEventListener('skena:enterEdit', onEnter);
    return () => window.removeEventListener('skena:enterEdit', onEnter);
  }, [id, startEdit]);

  // - while the node is selected (preview mode): Enter → edit; the run combos run in
  // - place. Capture phase so Alt+J/R beat the spatial-nav handler. (In edit mode the
  // - Monaco addCommands above handle the same combos.)
  useEffect(() => {
    if (!selected || editing) return;
    const onKey = (e: KeyboardEvent) => {
      // - don't hijack keys while the user is typing somewhere else (chat input, search,
      // - another Monaco) — this node can stay React-Flow-"selected" in the background.
      // - check both the event target and the focused element, and any enclosing editor.
      const inField = (el: HTMLElement | null) => !!el && (
        el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable ||
        !!el.closest?.('textarea, input, [contenteditable="true"], .monaco-editor')
      );
      if (inField(e.target as HTMLElement | null) || inField(document.activeElement as HTMLElement | null)) return;
      // - while the g badges are shown the next key is theirs; this listener may run before theirs
      if (document.documentElement.hasAttribute(G_BADGES_ATTR)) return;
      // - Ctrl/Cmd+C interrupts a RUNNING cell (host shows a confirm — it's easy to mishit). Only
      // - fires when this cell is running; otherwise it falls through (no node-copy binding here).
      if (isRunningRef.current && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault(); e.stopPropagation();
        interruptRef.current(true);
        return;
      }
      const runCombo =
        (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && ['r', 'R', 'j', 'J'].includes(e.key)) ||
        ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') ||
        (e.shiftKey && !e.altKey && e.key === 'Enter');
      if (runCombo) { e.preventDefault(); e.stopPropagation(); runRef.current(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(); return; }
      // - vim `o`: open a new code cell below, chained to this one. CanvasView computes a
      // - non-overlapping position (it has the full node list) and creates node + edge.
      if (e.key === 'o' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        window.dispatchEvent(new CustomEvent('skena:addCodeBelow', { detail: { sourceId: id } }));
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [selected, editing, startEdit]);

  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    // - register the kernel-backed completion provider once (idempotent)
    ensureKernelCompletion(monacoInstance);
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();
    const dark  = isDark;

    // - match the shiki preview: when the factors markdown theme is active, colour the editor
    // - tokens with the same factors palette (teal keywords / amber strings / …) so preview
    // - and edit look like the same theme. Otherwise a VS-Code-Dark+-ish default.
    const factors = document.documentElement.dataset.mdTheme === 'factors';
    const rules = factors
      ? [
          { token: 'comment',    foreground: '56635d', fontStyle: 'italic' },
          { token: 'keyword',    foreground: '4cc8a0' },
          { token: 'string',     foreground: 'd9a23f' },
          { token: 'number',     foreground: 'e5707a' },
          { token: 'type',       foreground: '4cc8a0' },
          { token: 'identifier', foreground: 'c7d1cc' },
          { token: 'operator',   foreground: '7c8a84' },
          { token: 'delimiter',  foreground: '7c8a84' },
        ]
      : [
          { token: 'keyword',    foreground: dark ? '569cd6' : '0070c1'                      },
          { token: 'comment',    foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },
          { token: 'string',     foreground: dark ? 'ce9178' : 'a31515'                      },
        ];

    monacoInstance.editor.defineTheme('skena-code', {
      base:    dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules,
      // - VS Code doesn't inject editor colours as CSS vars into webviews, so bake the palette
      // - here. Not dynamic — edit these to retune the code cell editor look.
      colors: {
        'editor.background':                        bg || (dark ? '#1e1e1e' : '#ffffff'),
        'editorCursor.foreground':                  '#f01010',
        'editor.lineHighlightBackground':           '#199ce809',
        'editor.lineHighlightBorder':               '#199ce805',
        'editor.selectionBackground':               '#212a66f0',
        'editor.selectionHighlightBackground':      '#ff402030',
        'editor.inactiveSelectionBackground':       '#29328080',
        'editor.wordHighlightBackground':           '#60020247',
        'editor.wordHighlightStrongBackground':     '#ffffff18',
        'editor.wordHighlightBorder':               '#f67e2220',
        'editor.wordHighlightStrongBorder':         '#c4854f50',
        'editorLineNumber.activeForeground':        LINE_NUMBER_ACTIVE_COLOR,
        'editorLineNumber.foreground':              LINE_NUMBER_COLOR,
        'editorWidget.border':                      '#000000',
        'editorBracketPairGuide.activeBackground1': '#00e7495e',
        'editorBracketPairGuide.activeBackground2': '#fac9285e',
        'editorBracketPairGuide.activeBackground3': '#057aff5e',
        'editorBracketPairGuide.activeBackground4': '#c122e95e',
        'editorBracketPairGuide.activeBackground5': '#f513845e',
        'editorBracketPairGuide.activeBackground6': '#19f9d85e',
      },
    });
  }, [isDark]);

  // - finish the debug log of a swap in the commit that takes the preview away (enter) or brings it
  // - back (leave): ms is the time from the request to this commit
  useLayoutEffect(() => {
    const log = swapLogRef.current;
    if (!log) return;
    if (log.direction === 'enter' && editorShown) {
      swapLogRef.current = null;
      console.debug('[skena codeSwap]', { ...log.report, ms: Math.round(performance.now() - enterAtRef.current) });
    } else if (log.direction === 'leave' && !editing) {
      swapLogRef.current = null;
      const pv = previewElRef.current ? previewLineRects(previewElRef.current, log.line) : { glyph: null, number: null };
      console.debug('[skena codeSwap]', {
        id, direction: 'leave', line: log.line, zoom: log.zoom,
        ms: Math.round(performance.now() - log.leftAt),
        // - true: the preview drew its colours in this first frame
        highlightedFromCache: cachedHighlight(code, language) !== undefined,
        ...swapReport(pv, log.editor),
      });
    }
  }, [editing, editorShown]);

  const status = node.lastStatus;
  const glyph = status === 'running' ? '◗' : status === 'ok' ? '✓' : status === 'error' ? '✗' : '';

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as { createdBy?: string }).createdBy} />
      <div
        ref={nodeElRef}
        className={`skena-node skena-node--code${node.lastStatus === 'running' ? ' skena-node--running' : ''}`}
        onContextMenu={onContextMenu}
        style={{
          border:        `${bw}px solid ${borderColor}`,
          height:        '100%',
          display:       'flex',
          flexDirection: 'column',
          borderRadius:  6,
          overflow:      'hidden',
          background:    'var(--vscode-editorWidget-background)',
          ...selectedStyle,
        }}
      >
        {/* - padding clears the corner resize handle (left) and the 34px label badge (right).
            - Fixed height: the status glyphs (◗ ✓ ✗) and the ■ button come from different fonts, and
              a height taken from their line boxes moved the editor below whenever the status changed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 40px 3px 14px', fontSize: 12, borderBottom: `1px solid ${borderColor}`, height: 24, boxSizing: 'border-box', flexShrink: 0, overflow: 'hidden' }}>
          <button
            onClick={e => { e.stopPropagation(); run(); }}
            disabled={!bound}
            title={bound ? 'Run on bound kernel (Shift+Enter)' : 'Connect this cell to a kernel node, or bind a kernel to its section, to run'}
            style={{ cursor: bound ? 'pointer' : 'not-allowed', background: 'transparent', border: 'none', color: bound ? borderColor : '#6b7280', fontSize: 13, padding: 0 }}
          >▶</button>
          {isRunning && (
            <button
              onClick={e => { e.stopPropagation(); interrupt(false); }}
              title="Interrupt execution (Ctrl+C)"
              style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: '#e5484d', fontSize: 12, padding: 0, lineHeight: 1 }}
            >■</button>
          )}
          <span style={{ opacity: 0.7 }}>{node.language ?? 'python'}</span>
          <span title={status ?? ''} style={{ marginLeft: 'auto', color: status === 'error' ? '#e5484d' : borderColor, fontSize: 14 }}>{glyph}</span>
        </div>
        {/* - one box for the editor and the preview. The preview always fills it absolutely, so laying
            it over the editor while the editor is being created changes nothing about its own box (its
            scroll offset stays). The editor below keeps its size, so Monaco measures and lays out as
            usual and can take focus; background inherit makes the preview hide it */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', background: 'inherit' }}>
          {editing && (
            /* - nodrag/nowheel: let Monaco own pointer + wheel (React Flow otherwise pans/zooms
               and never gives the editor focus); stopPropagation keeps RF hotkeys off while typing and
               a click on the code out of onNodeClick, which would pan the canvas */
            <div
              className="nodrag nowheel"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            >
              <Editor
                height="100%"
                loading={null}   // - Monaco is bundled (loader.config in index.tsx); skip the "Loading…" flash
                defaultLanguage="python"
                language="python"
                theme="skena-code"
                beforeMount={beforeMount}
                onMount={onEditorMount}
                value={code}
                onChange={v => {
                  const next = v ?? '';
                  setCode(next);
                  window.dispatchEvent(new CustomEvent('skena:nodeCodeEdit', { detail: { id, code: next } }));
                  // - the layout engine sizes a code cell by what its text needs. Fired from onChange,
                  // - not from onDidChangeModelContent: the latter also fires when the editor takes in
                  // - a `value` written elsewhere (MCP, a disk reload, undo), which must resize
                  // - nothing. So this only ever runs on the user's own edit, with the editor open.
                  reportHeight();
                }}
                options={{
                  ...cellEditorLayout(editorFont),
                  minimap:              { enabled: false },
                  autoIndent:           'full',  // - keep indentation + indent after `:` on Enter
                  tabSize:              4,
                  insertSpaces:         true,
                  scrollBeyondLastLine: false,
                  overviewRulerLanes:   0,
                  renderLineHighlight:  'all',  // - show the theme's line-highlight bg/border
                  scrollbar:            { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
                  automaticLayout:      true,
                  padding:              { top: 0, bottom: 0 },   // - align top edge with the preview
                  cursorWidth:          3,
                  // - render suggest / hover / signature popups at a body-level node so the
                  // - node's overflow:hidden doesn't clip them and React Flow's viewport
                  // - transform doesn't push the position:fixed widgets off-screen
                  fixedOverflowWidgets:  true,
                  overflowWidgetsDomNode: overflowWidgetsRoot(),
                }}
              />
              {/* - vim mode status bar. Fixed height: empty in normal mode, a line of text in insert mode
                  or with a pending `:` command, and each change resized the editor above it */}
              <div ref={vimStatusRef} className="skena-code-vim-status" style={{ fontSize: 10, opacity: 0.6, padding: '0 6px', fontFamily: 'var(--vscode-editor-font-family, monospace)', height: 14, lineHeight: '14px', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap' }} />
            </div>
          )}
          {(!editing || !editorShown) && (
            /* - read-only highlighted preview; ScrollableContent gives the wheel-guard so it
               - actually scrolls (a bare nowheel div doesn't). Double-click (or Enter) to edit.
               - Over the editor, pointer events go through to the editor below. */
            <ScrollableContent
              ref={previewElRef}
              scrollKey={`${id}-code`}
              className="skena-code-cell-preview"
              style={{
                padding: 0, cursor: 'text', position: 'absolute', inset: 0, zIndex: 1, background: 'inherit',
                pointerEvents: editing ? 'none' : undefined,
              }}
            >
              <div onDoubleClick={startEdit} title="Double-click to edit">
                {code.trim()
                  ? <CodeCellPreview code={code} language={language} cursorLine={savedViewState.current?.cursorState[0]?.position.lineNumber ?? 1} font={editorFont} maxDigitWidth={maxDigitWidth} dark={isDark} />
                  : <div style={{ padding: 8, opacity: 0.5, fontSize: 12, fontStyle: 'italic' }}>empty — double-click to edit</div>}
              </div>
            </ScrollableContent>
          )}
        </div>
      </div>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="nodrag"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000,
            background: 'var(--vscode-menu-background, #252526)',
            color: 'var(--vscode-menu-foreground, #ccc)',
            border: '1px solid var(--vscode-menu-border, rgba(255,255,255,0.15))',
            borderRadius: 6, padding: '4px 0', minWidth: 160, fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <button
            disabled={!isRunning}
            onClick={() => { interrupt(false); closeMenu(); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '4px 12px',
              background: 'transparent', border: 'none', fontSize: 12,
              cursor: isRunning ? 'pointer' : 'default',
              color: isRunning ? 'inherit' : 'var(--vscode-disabledForeground, #777)',
            }}
            onMouseEnter={e => { if (isRunning) (e.currentTarget as HTMLElement).style.background = 'var(--vscode-menu-selectionBackground, #094771)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >Interrupt execution</button>
        </div>,
        document.body,
      )}
      <NodeResizer
        minWidth={160} minHeight={90} isVisible={selected && !editing}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}

export const CodeNodeComponent = memo(CodeNodeInner);
