/**
 * palette — all of skena's own brand colors in one place, so the canvas look can be
 * tuned from a single file. Edit a value and rebuild (stop → F5 in the dev host).
 *
 * NOT here on purpose: `var(--vscode-*)` theme variables scattered through the code —
 * those intentionally adapt to the user's active VS Code theme (light/dark) and must
 * stay as theme references, not frozen constants.
 *
 * Colors used at several opacities are stored as an `R, G, B` triplet string; compose
 * them with `rgba(${TRIPLET}, <alpha>)`. Solid one-offs are plain hex.
 *
 * A few purely-CSS colors live in `styles/canvas.css` (node drop-shadow hairline, the
 * space-pinned ring) — they can't import from TS; see the comment there.
 */

// ─── node borders (fallback when a node has no Obsidian accent color) ───────────
// - keyed by NODE TYPE (`node.type`): each is the border of that kind of node.
export const DEFAULT_NODE_BORDER_BY_TYPE = {
  text:   '#1f96bd',                 // - text node — inline text / markdown notes
  file:   '#de780b',                 // - file node — file previews (.md/.ipynb/.py/.yaml/images)
  cell:   '#1f96bd',                 // - cell node — pinned outputs (image / plotly / html / markdown)
  link:   '#247c06',                 // - link node — URL links
  chat:   '#a882ff',                 // - chat node — AI chat / agent terminal
  portal: '#53dfdd',                 // - portal node — link to another .canvas
  group:  'rgba(255,255,255,0.12)',  // - group node — dashed background container
} as const;

// ─── connection edges (links between nodes) ─────────────────────────────────────
export const DEFAULT_EDGE_COLOR = '#1f96bd';   // - default edge stroke (no color set)
export const EDGE_FALLBACK_COLOR = '#888888';  // - last-resort stroke if style has none

// ─── selection / focus ring (crisp outline drawn around the focused node) ───────
export const SELECTION_RING_COLOR = 'rgba(0, 220, 255, 0.8)';

// ─── connection handles (the square ports on node edges) ────────────────────────
export const HANDLE_RGB = '0, 229, 255';   // - cyan; used as bg 0.06 / border 0.75 / glow 0.25

// ─── node label badge (the "N4" / "M2" reference tag at a node's corner) ────────
export const LABEL_TEXT_COLOR       = 'rgba(0, 255, 0, 0.92)';   // - label glyph (green)
export const LABEL_BG_COLOR         = 'rgba(0, 0, 0, 0.55)';     // - label pill background
export const LABEL_CREATED_BY_BG    = 'rgba(100, 60, 220, 0.80)'; // - "created by AI" badge bg

// ─── AI chat (FloatingChat message roles + input) ───────────────────────────────
export const CHAT_USER_RGB      = '16, 170, 16';    // - user message accent (green)
export const CHAT_ASSISTANT_RGB = '167, 139, 250';  // - assistant accent (purple, #A78BFA)
export const CHAT_ERROR_RGB     = '248, 113, 113';  // - error text / banner (red, #F87171)
export const CHAT_ACCENT_RGB    = '56, 189, 248';   // - input glyph + focused-panel glow (blue)

// ─── activity heatmap (gh) cluster glow palette ─────────────────────────────────
// - one color per connected thread cluster (cycled); isolated nodes use GRAY.
export const HEATMAP_PALETTE = [
  '56,189,248',    // - cyan
  '251,146,60',    // - orange
  '167,139,250',   // - purple
  '52,211,153',    // - green
  '244,114,182',   // - pink
  '250,204,21',    // - yellow
] as const;
export const HEATMAP_GRAY = '140,140,140';   // - isolated (unconnected) nodes
