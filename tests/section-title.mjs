// - run: npx esbuild src/webview/rail/sectionTitle.ts --bundle --format=esm --outfile=tests/.build/sectionTitle.mjs && node --test tests/section-title.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sectionTitleParts, kernelDisplayName } from './.build/sectionTitle.mjs';

const CREATED = Date.UTC(2026, 9, 15, 12, 30);

test('sectionTitleParts: a titled section with a kernel reads "S8: Hedging · quantkit"', () => {
  assert.deepEqual(sectionTitleParts({ label: 'S8', title: 'Hedging', createdAt: CREATED }, 'quantkit'),
    { title: 'Hedging', head: 'S8: Hedging', kernel: 'quantkit', text: 'S8: Hedging · quantkit' });
});

test('sectionTitleParts: no kernel → the title alone', () => {
  assert.deepEqual(sectionTitleParts({ label: 'S8', title: 'Hedging', createdAt: CREATED }, null),
    { title: 'Hedging', head: 'S8: Hedging', kernel: null, text: 'S8: Hedging' });
});

test('sectionTitleParts: an untitled (or blank) section shows its date, and the kernel after it', () => {
  const d = new Date(CREATED);
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  assert.deepEqual(sectionTitleParts({ label: 'S2', createdAt: CREATED }, 'py311'),
    { title: date, head: `S2: ${date}`, kernel: 'py311', text: `S2: ${date} · py311` });
  assert.equal(sectionTitleParts({ label: 'S2', title: '   ', createdAt: CREATED }, null).text, `S2: ${date}`);
});

test('sectionTitleParts: the title is trimmed', () => {
  assert.equal(sectionTitleParts({ label: 'S1', title: '  Setup ', createdAt: CREATED }, 'quantkit').text, 'S1: Setup · quantkit');
});

test('kernelDisplayName: a record shows its display name, a kernel node its kernel name, not K1', () => {
  assert.equal(kernelDisplayName({ kind: 'record', label: 'quantkit', name: 'local' }), 'quantkit');
  assert.equal(kernelDisplayName({ kind: 'node', label: 'K1', name: 'Python 3.11' }), 'Python 3.11');
  assert.equal(kernelDisplayName(null), null);
});
