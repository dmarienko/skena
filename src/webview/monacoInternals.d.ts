/**
 * Types for the few Monaco 0.55 modules the code cell preview imports by path. They are not part of
 * Monaco's public typings; only what the preview calls is declared.
 */

declare module 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js' {
  import type { editor } from 'monaco-editor';
  export class TokenTheme {
    static createFromRawTokenTheme(source: editor.ITokenThemeRule[], customTokenColors: string[]): TokenTheme;
    getColorMap(): { toString(): string }[];
    _match(token: string): { metadata: number };
  }
}

declare module 'monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js' {
  export const TokenMetadata: {
    getForeground(metadata: number): number;
    getFontStyle(metadata: number): number;
  };
}

declare module 'monaco-editor/esm/vs/editor/standalone/common/themes.js' {
  import type { editor } from 'monaco-editor';
  export const vs: editor.IStandaloneThemeData;
  export const vs_dark: editor.IStandaloneThemeData;
}

declare module 'monaco-editor/esm/vs/editor/common/model/indentationGuesser.js' {
  export interface IndentationSource {
    getLineCount(): number;
    getLineLength(lineNumber: number): number;
    getLineContent(lineNumber: number): string;
    getLineCharCode(lineNumber: number, index: number): number;
  }
  export function guessIndentation(source: IndentationSource, defaultTabSize: number, defaultInsertSpaces: boolean): { tabSize: number; insertSpaces: boolean };
}

declare module 'monaco-editor/esm/vs/editor/common/model/guidesTextModelPart.js' {
  export interface GuidesModel {
    getLineCount(): number;
    getLineContent(lineNumber: number): string;
    getOptions(): { tabSize: number; indentSize: number };
    getLanguageId(): string;
  }
  export interface GuidesLanguageConfiguration {
    getLanguageConfiguration(languageId: string): { foldingRules?: { offSide?: boolean } };
  }
  export class GuidesTextModelPart {
    constructor(textModel: GuidesModel, languageConfigurationService: GuidesLanguageConfiguration);
    getLinesIndentGuides(startLineNumber: number, endLineNumber: number): number[];
    getActiveIndentGuide(lineNumber: number, minLineNumber: number, maxLineNumber: number): { startLineNumber: number; endLineNumber: number; indent: number };
  }
}
