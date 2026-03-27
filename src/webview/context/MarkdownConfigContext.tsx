/**
 * MarkdownConfigContext — provides VS Code markdown.preview.* settings
 * (fontFamily, fontSize, external stylesheets) to all MarkdownRenderer instances.
 *
 * The context value is populated once the host sends a 'markdownConfig' message.
 * Until then, an empty default is used (no font override, no external CSS).
 */

import React, { createContext, useContext } from 'react';
import { MarkdownConfig } from '../../shared/types';

export const DEFAULT_MARKDOWN_CONFIG: MarkdownConfig = {
  fontFamily: undefined,
  fontSize:   undefined,
  styles:     [],
};

export const MarkdownConfigContext = createContext<MarkdownConfig>(DEFAULT_MARKDOWN_CONFIG);

export function useMarkdownConfig(): MarkdownConfig {
  return useContext(MarkdownConfigContext);
}
