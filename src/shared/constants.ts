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

/**
 * Canvas snap grid — the single step shared by the webview (drag/resize snap + markdown
 * line-height via --skena-grid) and the host MCP tools (agent-created / moved / resized nodes),
 * so every node lands on the same grid regardless of who moved it. Tweak GRID and it all follows.
 * (`snapGrid()` lives in ./grid.ts and reads this value.)
 */
export const GRID = 100;

/**
 * Node geometry — the single source of truth for how big NEW nodes are created.
 * Every creation path (context menu, directional-add, edge-drop, vim `o`, host add-node,
 * and the kernel/link/portal/file widgets) reads from here. Tune these to change sizes
 * everywhere at once. New-node spawn positions are derived from these (w/2, h/2), so a
 * width change keeps nodes centred. The snap GRID step (below) is the one other knob.
 */
export const NODE_SIZE = {
  text:   { w: 700, h: 300 },
  code:   { w: 700, h: 300 },
  link:   { w: 300, h: 100 },
  portal: { w: 200, h: 200 },
  kernel: { w: 140, h: 160 },
  file:   { w: 700, h: 700 },
} as const;

// - bigger, deliberate size for a brand-new node created by directional-add (Alt+X /
//   Ctrl+Shift+hjkl) or by dropping an edge on empty canvas; `gap` = spawn distance from source.
export const NEW_NODE = { w: 700, h: 300, gap: 100 } as const;

// - a section (except the last) is never shorter than this: room for two default nodes and two gaps
export const SECTION_MIN_H    = 2 * NODE_SIZE.code.h + 2 * GRID;
// - a folded section's range; keep it ≥ GRID — sectionTargetHeight's floor relies on it
export const SECTION_FOLDED_H = GRID;

// - generic fallback (kept for back-compat; equals the text-node size)
export const DEFAULT_NODE_WIDTH  = NODE_SIZE.text.w;
export const DEFAULT_NODE_HEIGHT = NODE_SIZE.text.h;

/**
 * File size thresholds for webview preview.
 *   ≤ MAX_FILE_FULL_BYTES    → sent in full
 *   > MAX_FILE_FULL_BYTES    → first MAX_FILE_PREVIEW_BYTES sent; truncated=true in response
 * Notebooks use a separate lower limit (they are pre-parsed JSON, not raw source).
 */
export const MAX_FILE_FULL_BYTES    = 2 * 1024 * 1024;  // - 2 MB: render completely
export const MAX_FILE_PREVIEW_BYTES = 200 * 1024;       // - 200 KB shown for oversized files
export const MAX_NOTEBOOK_BYTES     = 10 * 1024 * 1024; // - 10 MB parsed notebook output

/** @deprecated kept for any external callers; equals MAX_FILE_FULL_BYTES */
export const MAX_FILE_SIZE_BYTES = MAX_FILE_FULL_BYTES;

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

/** - file type → header accent color (used as low-opacity tint in NodeHeader) */
export const FILE_TYPE_COLORS: Record<string, string> = {
  markdown: '#4b9ef5',  //  — documents / notes
  notebook: '#f59e0b',  //  — Jupyter notebooks
  python:   '#3fb950',  //  — Python source
  yaml:     '#a78bfa',  //  — config / data
  image:    '#727df4',  //  — visual assets
  notion:   '#e2e8f0',  //  — Notion pages
  unknown:  '#6b7280',  //  — unrecognised files
};
