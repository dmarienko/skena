/**
 * A node's markdown as the canvas renders it: on the host (Typst and MathML, markdown-html.ts) when
 * useHostMarkdown would send it there, else as the webview's MarkdownRenderer does (KaTeX HTML);
 * markdown cells always as MarkdownRenderer does.
 * Under the factors markdown theme the fenced blocks of host html are coloured as the webview
 * colours them. No vscode import.
 */

import type { HighlighterCore } from 'shiki/core';
import { renderMarkdownKatexHtml, renderMarkdownToHtml } from '../markdown-html';
import { hasCodeBlocks, highlightCodeBlocks } from '../../shared/markdownCodeBlocks';

type BlockHighlighter = Pick<HighlighterCore, 'codeToHtml' | 'getLoadedLanguages'>;

/** - useHostMarkdown's routing: a `%` (Typst) or, under the factors theme, a fenced block */
export function rendersOnHost(text: string, factors: boolean): boolean {
  return text.includes('%') || (factors && text.includes('```'));
}

/** `text` (a text note, a knowledge node, a markdown cell) as html, routed as the canvas routes it. */
export async function nodeMarkdownHtml(text: string, factors: boolean, hl: BlockHighlighter | null): Promise<string> {
  if (!rendersOnHost(text, factors)) return renderMarkdownKatexHtml(text);
  return fileMarkdownHtml(text, factors, hl);
}

/** - a markdown output cell or a notebook's markdown cell: CellNode and NotebookRenderer render it with MarkdownRenderer itself, never on the host */
export function rendererMarkdownHtml(text: string): Promise<string> {
  return renderMarkdownKatexHtml(text);
}

/** - a markdown file: always the host renderer, as handleRequestFile renders it */
export async function fileMarkdownHtml(text: string, factors: boolean, hl: BlockHighlighter | null): Promise<string> {
  const html = await renderMarkdownToHtml(text);
  return factors && hl && hasCodeBlocks(html) ? highlightCodeBlocks(html, hl) : html;
}
