/**
 * Word completion from the current canvas for the text-node editor and the chat input.
 * Registers ONE Monaco completion provider for 'markdown', the language of both editors.
 * Code cells are 'python' and keep their kernel completion (kernelCompletion.ts).
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { CanvasNode } from '../../shared/types';
import { buildWordList, matchWords, wordBefore, type WordCount } from './canvasWords';

export const CANVAS_WORDS_LANGUAGE = 'markdown';

let registered = false;
let words: WordCount[] = [];

/**
 * Replace the word list with the words of `nodes`. CanvasView calls this debounced after the canvas changes.
 */
export function setCanvasWords(nodes: CanvasNode[]): void {
  words = buildWordList(nodes);
}

export function ensureCanvasWordCompletion(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider(CANVAS_WORDS_LANGUAGE, {
    provideCompletionItems: (model, position) => {
      const typed = wordBefore(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber, startColumn: position.column - typed.length,
        endLineNumber:   position.lineNumber, endColumn:   position.column,
      };
      return {
        // - asked again on every typed character, so the 50-word cap applies to the current prefix
        incomplete: true,
        suggestions: matchWords(words, typed).map((w, i) => ({
          label:      w,
          kind:       monaco.languages.CompletionItemKind.Text,
          insertText: w,
          range,
          sortText:   String(i).padStart(3, '0'),
        })),
      };
    },
  });
}
