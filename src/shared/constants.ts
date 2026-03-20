/**
 * Shared constants — colors, defaults, node geometry.
 * Used in both extension host and webview.
 */

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
};

export const DEFAULT_NODE_WIDTH  = 400;
export const DEFAULT_NODE_HEIGHT = 250;

/** - max file content size sent to webview (500 KB) */
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

/** - vault URI prefix */
export const VAULT_SCHEME = 'vault://';

/** - special vault name for Notion pages */
export const NOTION_VAULT_NAME = 'notion';

/** - debounce delay for canvas auto-save (ms) */
export const AUTO_SAVE_DELAY_MS = 500;

/** - status badge colors for strategy statuses */
export const STATUS_COLORS: Record<string, string> = {
  idea:      '#6b7280',
  research:  '#3b82f6',
  backtest:  '#f59e0b',
  paper:     '#8b5cf6',
  live:      '#10b981',
  paused:    '#f97316',
  dead:      '#ef4444',
};

/** - score indicator colors */
export const SCORE_COLORS: Record<string, string> = {
  bad:         '#ef4444',
  'not-sure':  '#6b7280',
  interesting: '#f59e0b',
  promising:   '#3b82f6',
  perfect:     '#10b981',
};

/** - file type → icon (codicon names) */
export const FILE_TYPE_ICONS: Record<string, string> = {
  markdown: 'markdown',
  notebook: 'notebook',
  python:   'symbol-file',
  yaml:     'settings-gear',
  image:    'file-media',
  notion:   'book',
  unknown:  'file',
};
