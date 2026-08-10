/**
 * Canvas snap grid — the single knob shared by the webview (drag/resize snap and the markdown
 * line-height via --skena-grid) and the host MCP tools (agent-created / moved / resized nodes),
 * so every node lands on the same grid regardless of who moved it. Tweak GRID and it all follows.
 */

export const GRID = 20;

// - nearest grid multiple
export function snapGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}
