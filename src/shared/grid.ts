/**
 * Canvas snap grid helper. GRID (the step) now lives in ./constants.ts as the single tuning
 * point, alongside NODE_SIZE / NEW_NODE; it is re-exported here so existing
 * `import { GRID, snapGrid } from '.../grid'` sites keep working unchanged.
 */

import { GRID } from './constants';

export { GRID };

// - nearest grid multiple
export function snapGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}
