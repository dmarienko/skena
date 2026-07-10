/**
 * defaultColors — the fallback node border colors, used when a node has no accent color
 * (i.e. no Obsidian color 1–6 assigned via `skena.colors`).
 *
 * Single place to tune the canvas's default look — edit the values below and rebuild.
 * Any CSS color works: hex (#454545), rgba(...), or a var(--vscode-*) theme variable.
 */

export const DEFAULT_NODE_BORDER = {
  text:   '#454545',                 // - inline text / markdown notes
  file:   '#454545',                 // - file preview nodes (.md/.ipynb/.py/.yaml/images)
  cell:   '#454545',                 // - pinned output cells (image / plotly / html / markdown)
  link:   '#454545',                 // - URL / link nodes
  chat:   '#a882ff',                 // - AI chat / agent terminal nodes
  portal: '#53dfdd',                 // - portal nodes linking to another .canvas
  group:  'rgba(255,255,255,0.12)',  // - group container (dashed background box)
} as const;

// - default connection edge (link) color, used when an edge has no color assigned.
// - visible on both dark and light VS Code themes.
export const DEFAULT_EDGE_COLOR = '#1f96bd';
