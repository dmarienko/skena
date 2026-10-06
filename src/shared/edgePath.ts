/**
 * The SVG path of a routed edge and the point its label sits on. LabeledEdge draws the canvas edges
 * with these, and the HTML export draws the same paths. Pure.
 */

export type PathPoint = [number, number];

// - the corner at `via` as a line to where the round starts and a quadratic curve through `via`
function roundedCorner(from: PathPoint, via: PathPoint, to: PathPoint, r: number): string {
  const d1x = from[0] - via[0], d1y = from[1] - via[1];
  const d1  = Math.sqrt(d1x * d1x + d1y * d1y);
  const d2x = to[0] - via[0], d2y = to[1] - via[1];
  const d2  = Math.sqrt(d2x * d2x + d2y * d2y);
  if (d1 < 0.01 || d2 < 0.01) return `L ${via[0]},${via[1]}`;
  const r1  = Math.min(r, d1 / 2);
  const r2  = Math.min(r, d2 / 2);
  const b1x = via[0] + (d1x / d1) * r1, b1y = via[1] + (d1y / d1) * r1;
  const b2x = via[0] + (d2x / d2) * r2, b2y = via[1] + (d2y / d2) * r2;
  return `L ${b1x},${b1y} Q ${via[0]},${via[1]} ${b2x},${b2y}`;
}

/** The polyline `pts` as an SVG path with every corner rounded by `r`; '' for fewer than two points. */
export function waypointPath(pts: readonly PathPoint[], r: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) d += ' ' + roundedCorner(pts[i - 1], pts[i], pts[i + 1], r);
  d += ` L ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  return d;
}

/** The middle of the polyline's middle segment, where the edge label goes. */
export function edgeLabelPoint(pts: readonly PathPoint[]): PathPoint {
  const mi = Math.max(1, Math.floor(pts.length / 2));
  return [(pts[mi - 1][0] + pts[mi][0]) / 2, (pts[mi - 1][1] + pts[mi][1]) / 2];
}
