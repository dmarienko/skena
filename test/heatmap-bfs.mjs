import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// - local copy of computeHeatmapData: importing the TS source directly from .mjs
// - requires a build step (tsx/ts-node). This copy validates the algorithm logic;
// - if a test runner is added later, replace with a direct import.
// - IMPORTANT: keep this copy in sync with src/webview/hooks/useActivityHeatmap.ts

const PALETTE = [
  '56,189,248',
  '251,146,60',
  '167,139,250',
  '52,211,153',
  '244,114,182',
  '250,204,21',
];
const GRAY = '140,140,140';
const INTENSITY_MIN = 0.40;   // - raised from 0.18 — ensures old nodes stay visible
const INTENSITY_MAX = 0.95;

function computeHeatmapData(nodes, edges, zoom = 1) {
  // - "pave" scaling: grow glow proportionally as zoom decreases
  const glowScale = Math.min(8, Math.pow(1 / Math.max(0.1, zoom), 1.5));

  // - build adjacency list (undirected)
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).push(e.target);
      adj.get(e.target).push(e.source);
    }
  }

  // - BFS connected components; isolated nodes get clusterId = null
  const clusterOf = new Map();
  let clusterCount = 0;
  const visited = new Set();

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const hasEdge = adj.get(n.id).length > 0;
    if (!hasEdge) {
      clusterOf.set(n.id, null);
      visited.add(n.id);
      continue;
    }
    const cid = clusterCount++;
    const queue = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift();
      clusterOf.set(cur, cid);
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
  }

  // - group nodes by cluster, rank by creationIndex within cluster
  const clusterNodes = new Map();
  for (const n of nodes) {
    const cid = clusterOf.get(n.id);
    if (!clusterNodes.has(cid)) clusterNodes.set(cid, []);
    clusterNodes.get(cid).push({ id: n.id, idx: n.data?.creationIndex ?? 0 });
  }

  // - compute intensity + glow CSS per node
  const nodeGlow = new Map();
  for (const [cid, members] of clusterNodes) {
    const sorted = [...members].sort((a, b) => a.idx - b.idx);
    const maxRank = sorted.length - 1;
    const isIso = cid === null;
    const color = isIso ? GRAY : PALETTE[cid % PALETTE.length];
    sorted.forEach((m, rank) => {
      const intensity = maxRank === 0
        ? INTENSITY_MAX
        : INTENSITY_MIN + (rank / maxRank) * (INTENSITY_MAX - INTENSITY_MIN);
      const r1 = Math.max(3, intensity * 9  * glowScale).toFixed(1);
      const r2 = Math.max(6, intensity * 18 * glowScale).toFixed(1);
      const glowFilter = isIso
        ? `drop-shadow(0 0 ${(2 * glowScale).toFixed(1)}px rgba(${color},0.25))`
        : `drop-shadow(0 0 ${r1}px rgba(${color},${intensity.toFixed(2)})) drop-shadow(0 0 ${r2}px rgba(${color},${(intensity * 0.45).toFixed(2)}))`;
      const borderAlpha = isIso ? 0.18 : Math.max(0.30, intensity * 0.65);
      nodeGlow.set(m.id, {
        color,
        intensity,
        clusterId: cid,
        glowFilter,
        borderColor: `rgba(${color},${borderAlpha.toFixed(2)})`,
        opacity: isIso ? 0.45 : 1.0,
      });
    });
  }

  // - edge glow: color of source cluster, intensity = max of endpoints
  const edgeGlow = new Map();
  for (const e of edges) {
    const sg = nodeGlow.get(e.source);
    const tg = nodeGlow.get(e.target);
    if (!sg || !tg) continue;
    const intensity = Math.max(sg.intensity, tg.intensity);
    const color = sg.color;
    edgeGlow.set(e.id, {
      color,
      intensity,
      stroke: `rgba(${color},${intensity.toFixed(2)})`,
      glowFilter: `drop-shadow(0 0 ${Math.max(2, intensity * 6 * glowScale).toFixed(1)}px rgba(${color},${(intensity * 0.6).toFixed(2)}))`,
    });
  }

  return { nodeGlow, edgeGlow };
}

test('isolated node gets gray and 0.45 opacity', () => {
  const result = computeHeatmapData(
    [{ id: 'a', data: {} }],
    []
  );
  const g = result.nodeGlow.get('a');
  assert.equal(g.color, GRAY);
  assert.equal(g.clusterId, null);
  assert.equal(g.opacity, 0.45);
});

test('single cluster of 2 nodes — newer node gets higher intensity', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 5 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const ga = result.nodeGlow.get('a');
  const gb = result.nodeGlow.get('b');
  assert.equal(ga.clusterId, gb.clusterId);
  assert.equal(ga.color, gb.color);
  assert(gb.intensity > ga.intensity, 'newer node must have higher intensity');
  assert.equal(ga.intensity, INTENSITY_MIN);
  assert.equal(gb.intensity, INTENSITY_MAX);
});

test('2-node cluster: oldest gets INTENSITY_MIN, newest gets INTENSITY_MAX', () => {
  const result = computeHeatmapData(
    [
      { id: 'x', data: { creationIndex: 3 } },
      { id: 'y', data: { creationIndex: 7 } },
    ],
    [{ id: 'e1', source: 'x', target: 'y' }]
  );
  assert.equal(result.nodeGlow.get('x').intensity, INTENSITY_MIN);
  assert.equal(result.nodeGlow.get('y').intensity, INTENSITY_MAX);
});

test('two separate clusters get different palette colors', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 2 } },
      { id: 'c', data: { creationIndex: 3 } },
      { id: 'd', data: { creationIndex: 4 } },
    ],
    [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'c', target: 'd' },
    ]
  );
  const colorAB = result.nodeGlow.get('a').color;
  const colorCD = result.nodeGlow.get('c').color;
  assert.notEqual(colorAB, colorCD);
  assert.notEqual(colorAB, GRAY);
  assert.notEqual(colorCD, GRAY);
});

test('edge glow uses source cluster color and max intensity of endpoints', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: { creationIndex: 1 } },
      { id: 'b', data: { creationIndex: 5 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const eg = result.edgeGlow.get('e1');
  const ng = result.nodeGlow.get('a');
  assert.equal(eg.color, ng.color);
  assert.equal(eg.intensity, INTENSITY_MAX);
});

test('nodes without creationIndex get rank 0 (treated as oldest)', () => {
  const result = computeHeatmapData(
    [
      { id: 'a', data: {} },
      { id: 'b', data: { creationIndex: 10 } },
    ],
    [{ id: 'e1', source: 'a', target: 'b' }]
  );
  const ga = result.nodeGlow.get('a');
  const gb = result.nodeGlow.get('b');
  assert(gb.intensity > ga.intensity);
});
