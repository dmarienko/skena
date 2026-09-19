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

import type { EdgeKind } from '../../shared/edgeRouting';

// ─── node borders (fallback when a node has no Obsidian accent color) ───────────
// - keyed by NODE TYPE (`node.type`): each is the border of that kind of node.
export const DEFAULT_NODE_BORDER_BY_TYPE = {
  text:   '#1f96bd',                 // - text node — inline text / markdown notes
  file:   '#de780b',                 // - file node — file previews (.md/.ipynb/.py/.yaml/images)
  cell:   '#1f96bd',                 // - cell node — pinned outputs (image / plotly / html / markdown)
  link:   '#247c06',                 // - link node — URL links
  chat:   '#a882ff',                 // - chat node — AI chat / agent terminal
  portal: '#53dfdd',                 // - portal node — link to another .canvas
  noderef: '#c98af0',                // - node reference (diamond) to a node in another canvas
  group:  'rgba(255,255,255,0.12)',  // - group node — dashed background container
  code:   '#02542e',                 // - code node — editable code cell (Jupyter)
  kernel: '#4cc8a0',                 // - kernel node — live Jupyter kernel widget
} as const;

/**
 * The border a node draws: the colour set on it, else the default for its kind. This is the exact
 * expression every node component uses, so an edge coloured with it matches the border of the node
 * it leaves. Undefined for a type the table does not know.
 */
export function nodeBorderColor(type: keyof typeof DEFAULT_NODE_BORDER_BY_TYPE, accentColor?: string): string;
export function nodeBorderColor(type: string | undefined, accentColor?: string): string | undefined;
export function nodeBorderColor(type: string | undefined, accentColor?: string): string | undefined {
  return accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE[type as keyof typeof DEFAULT_NODE_BORDER_BY_TYPE];
}

// ─── selection / focus ring (crisp outline drawn around the focused node) ───────
export const SELECTION_RING_COLOR = '#f7430280';

// ─── connection handles (the square ports on node edges) ────────────────────────
export const HANDLE_RGB = '0, 229, 255';   // - cyan; used as bg 0.06 / border 0.75 / glow 0.25

// ─── node label badge (the "N4" / "M2" reference tag at a node's corner) ────────
export const LABEL_TEXT_COLOR       = 'rgba(0, 255, 0, 0.92)';   // - label glyph (green)
export const LABEL_BG_COLOR         = 'rgba(17, 165, 191, 0.27)';     // - label pill background
export const LABEL_CREATED_BY_BG    = 'rgba(100, 60, 220, 0.80)'; // - "created by AI" badge bg

// ─── AI chat (FloatingChat message roles + input) ───────────────────────────────
export const CHAT_USER_RGB      = '16, 170, 16';    // - user message accent (green)
export const CHAT_ASSISTANT_RGB = '167, 139, 250';  // - assistant accent (purple, #A78BFA)
export const CHAT_ERROR_RGB     = '248, 113, 113';  // - error text / banner (red, #F87171)
export const CHAT_ACCENT_RGB    = '56, 189, 248';   // - input glyph + focused-panel glow (blue)

// - per-kernel accent colors — defined in shared/ so the host can use them too
export { KERNEL_PALETTE, kernelColor, nextKernelColorIndex } from '../../shared/kernelPalette';

// - neutral chrome tokens (the rail now, the node restyle next). Picked by the VS Code theme kind and
// - exposed as --sk-* CSS variables on <html> by src/webview/theme.ts
// - edgeSequence / edgeOutput / edgeContext are the three edge kinds of edgeRouting.ts (spec
// - 2026-09-11-edges-design.md §3): a muted green for code -> code, a muted blue for a cell and its
// - output, a muted violet for everything else, including user-drawn links. All three are drawn at
// - 60% opacity on a 1 px line, so they read as chrome rather than as content.
export const THEME = {
  light: { bg1: '#f5f5f7', bg2: '#ffffff', bg3: '#e5e5e7', border: '#d1d1d6', text1: '#1d1d1f', text2: '#86868b', text3: '#aeaeb2', accent: '#0071e3',
           edgeSequence: '#5a8f77', edgeOutput: '#5b7fb0', edgeContext: '#8a7db5' },
  dark:  { bg1: '#1d1d1f', bg2: '#2d2d2f', bg3: '#3d3d3f', border: '#424245', text1: '#f5f5f7', text2: '#86868b', text3: '#636366', accent: '#0a84ff',
           edgeSequence: '#6f9e86', edgeOutput: '#6f8fc0', edgeContext: '#9a8fc4' },
} as const;

// - the VS Code theme kind, from the class VS Code puts on <body>. No DOM (a node test) reads as light.
export function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.body.classList;
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast');
}

const EDGE_KIND_TOKEN = { sequence: 'edgeSequence', output: 'edgeOutput', context: 'edgeContext' } as const;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// - h in degrees, s and l in 0..1
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0))
          : max === gn ? (bn - rn) / d + 2
          : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
                  : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** The same colour moved `amount` (0..1) of the way from its lightness to white. */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb || amount <= 0) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToHex(h, s, l + (1 - l) * Math.min(1, amount));
}

/**
 * Stroke for one edge: its kind's colour, one per kind. The edges of one border are told apart by
 * their exit point and by the line style, not by a colour of their own.
 */
export function edgeKindColor(kind: EdgeKind): string {
  return (isDarkTheme() ? THEME.dark : THEME.light)[EDGE_KIND_TOKEN[kind]];
}
