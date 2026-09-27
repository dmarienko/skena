// - the chat console's saved state per canvas
export interface ChatUIState {
  // - null: nothing saved; the console uses its default width
  width:  number | null;
  folded: boolean;
}

function validWidth(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// - reads both { width, folded } and the floating panel's { collapsed, pos, size, inputW }.
// - size.w becomes the width and collapsed becomes folded; pos and inputW have no counterpart.
export function migrateChatUI(saved: unknown): ChatUIState {
  if (!saved || typeof saved !== 'object') return { width: null, folded: false };
  const o    = saved as Record<string, unknown>;
  const size = o.size as Record<string, unknown> | null | undefined;
  const width  = validWidth(o.width) ?? validWidth(size?.w);
  const folded = typeof o.folded === 'boolean' ? o.folded
               : typeof o.collapsed === 'boolean' ? o.collapsed
               : false;
  return { width, folded };
}
