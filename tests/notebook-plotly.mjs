// tests/notebook-plotly.mjs
// - behavioral tests: notebook parser extracts plotly outputs, prefers them over sibling PNG.
// - run: npx esbuild src/extension/notebook-parser.ts --bundle --format=esm --outfile=tests/.build/notebook-parser.mjs && node --test tests/notebook-plotly.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseNotebook } from './.build/notebook-parser.mjs';

const nbWithPlotly = JSON.stringify({
  nbformat: 4,
  metadata: { language_info: { name: 'python' } },
  cells: [{
    cell_type: 'code',
    source: 'fig',
    execution_count: 1,
    outputs: [{
      output_type: 'execute_result',
      data: {
        'application/vnd.plotly.v1+json': { data: [{ type: 'scatter', y: [1, 2, 3] }], layout: { title: 'T' } },
        'image/png': 'AAAA',
        'text/plain': 'Figure(...)',
      },
    }],
  }],
});

test('plotly output extracted with json string, preferred over png', () => {
  const nb = parseNotebook(nbWithPlotly);
  const outs = nb.cells[0].outputs;
  assert.equal(outs.length, 1, 'exactly one output (png/text suppressed)');
  assert.equal(outs[0].mimeType, 'application/vnd.plotly.v1+json');
  const fig = JSON.parse(outs[0].json);
  assert.deepEqual(fig.data[0].y, [1, 2, 3]);
  assert.equal(fig.layout.title, 'T');
});

test('widget-view (FigureWidget) still becomes a placeholder', () => {
  const nb = parseNotebook(JSON.stringify({
    nbformat: 4, cells: [{
      cell_type: 'code', source: 'w', outputs: [{
        output_type: 'display_data',
        data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'x' }, 'text/plain': 'FigureWidget(...)' },
      }],
    }],
  }));
  const outs = nb.cells[0].outputs;
  assert.equal(outs[0].mimeType, 'placeholder');
});

test('png-only output still extracts png (no regression)', () => {
  const nb = parseNotebook(JSON.stringify({
    nbformat: 4, cells: [{
      cell_type: 'code', source: 'p', outputs: [{
        output_type: 'execute_result', data: { 'image/png': 'BBBB' },
      }],
    }],
  }));
  assert.equal(nb.cells[0].outputs[0].mimeType, 'image/png');
  assert.equal(nb.cells[0].outputs[0].data, 'BBBB');
});
