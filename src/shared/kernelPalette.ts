/**
 * kernelPalette — the per-kernel accent colors, in `shared/` so the host can use them too.
 * The webview reads them through `canvas/palette.ts`, which re-exports this file.
 */

// - per-kernel accent colors, cycled by creation order (kernel node circles, rail stripes and picker rows)
export const KERNEL_PALETTE: string[] = [
  '#4cc8a0',   // - teal
  '#d9a23f',   // - amber
  '#7aa2f7',   // - blue
  '#e5707a',   // - red
  '#bb9af7',   // - violet
  '#9ece6a',   // - green
];

export function kernelColor(colorIndex: number): string {
  const n = KERNEL_PALETTE.length;
  return KERNEL_PALETTE[((colorIndex % n) + n) % n];
}

export function nextKernelColorIndex(existingKernelCount: number): number {
  return existingKernelCount % KERNEL_PALETTE.length;
}
