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
const INTENSITY_MIN   = 0.40;
const INTENSITY_MAX   = 0.95;
const INTENSITY_CURVE = 2.5;  // - power curve: compresses old, spreads recent

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
      const t = maxRank === 0 ? 1 : Math.pow(rank / maxRank, INTENSITY_CURVE);
      const intensity = INTENSITY_MIN + t * (INTENSITY_MAX - INTENSITY_MIN);
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
    const glowBlur  = Math.max(2, intensity * 5  * glowScale);
    const glowWidth = Math.max(8, intensity * 12 * glowScale);
    edgeGlow.set(e.id, {
      color,
      intensity,
      sourceIntensity: sg.intensity,
      targetIntensity: tg.intensity,
      stroke:          `rgba(${color},${intensity.toFixed(2)})`,
      glowFilter:      `drop-shadow(0 0 ${Math.max(2, intensity * 6 * glowScale).toFixed(1)}px rgba(${color},${(intensity * 0.6).toFixed(2)}))`,
      glowBlur,
      glowWidth,
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

test('power curve: recent nodes have larger intensity gaps than old nodes (15-node chain)', () => {
  // - build a 15-node chain connected oldest→newest
  const nodes = Array.from({ length: 15 }, (_, i) => ({
    id: `n${i}`, data: { creationIndex: i + 1 },
  }));
  const edges = Array.from({ length: 14 }, (_, i) => ({
    id: `e${i}`, source: `n${i}`, target: `n${i + 1}`,
  }));
  const result = computeHeatmapData(nodes, edges);

  const intensities = nodes.map(n => result.nodeGlow.get(n.id).intensity);
  // - step between the two most recent nodes
  const stepTop  = intensities[14] - intensities[13];
  // - step between the two oldest nodes
  const stepBot  = intensities[1]  - intensities[0];

  assert(stepTop > stepBot * 2,
    `recent step ${stepTop.toFixed(3)} should be >2× the old step ${stepBot.toFixed(3)}`);
  // - boundary values still intact
  assert.equal(intensities[0],  INTENSITY_MIN);
  assert.equal(intensities[14], INTENSITY_MAX);
});

test('edge gradient direction: sourceIntensity < targetIntensity when source is older', () => {
  // - source created first (lower index = older) → source end should be dimmer (old-end of gradient)
  const result = computeHeatmapData(
    [
      { id: 'old', data: { creationIndex: 1 } },
      { id: 'new', data: { creationIndex: 9 } },
    ],
    [{ id: 'e1', source: 'old', target: 'new' }]
  );
  const eg = result.edgeGlow.get('e1');
  assert(eg.sourceIntensity < eg.targetIntensity,
    'source (older node) must have lower intensity than target (newer node)');
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
