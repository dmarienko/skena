# g Preview Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-09-25-g-preview-cards-design.md` (`ee2c3c0`). When `g` shows the connection badges, show next to each badge a small card for the node that connection leads to. Badges and cards stay until the next key or click.

**Architecture:** Two pure modules hold the logic and are tested in node: `cardContent.ts` turns a node's data into what its card shows, and `hintPlacement.ts` places badges and cards in pane pixels. `gChord.ts` is a third pure module: it decides what the key after `g` does. `PreviewCard.tsx` draws one card without Monaco. `EdgeFollowHints.tsx` draws badges, cards and the lines back to them. `CanvasView.tsx` builds the cards when `g` is pressed and reads the next key at capture while the badges are shown.

**Tech Stack:** TypeScript, React 18, React Flow v12, shiki 1.29 (already bundled for the code preview), react-markdown + KaTeX, the host's typst render (`useHostMarkdown`), esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Before you start

- Work on branch `feature/spatial-notebook`. Commit only the files each task names.
- Another agent is changing `src/shared/layoutEngine.ts`. Do not open, edit or stage it.
- `src/webview/styles/canvas.css`, `.vscode/skena-mcp.js` and the untracked `.vscode/numbered-bookmarks.json` carry changes that are not yours. Never stage them. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged.
- Never read a `.canvas` file directly.
- Typecheck baseline at `ee2c3c0`: `npx tsc --noEmit` reports 3 errors, all in `src/extension/editor-provider.ts` (`fsPath` on `ResolvedUri`). They are old. The typecheck command in this plan filters them out:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"
  ```

  Expected output: nothing. An error in `src/shared/layoutEngine.ts` belongs to the other agent: stop and report it.
- The code in this plan was compiled with `tsc`, built with `npm run build`, and its tests run, in a scratch copy of the repo at `ee2c3c0` on 2026-09-25: 13 + 5 + 5 tests pass, `spatial-nav` still 44 of 44.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/webview/canvas/cardContent.ts` | create | Pure. What a node's card shows: label, type text, border, body. One rule per node type. Also `noteSnippet`, `firstHeading`, `htmlLines`. |
| `src/webview/canvas/hintPlacement.ts` | create | Pure. `EdgeHint` type, `placeBadges` (moved out of `EdgeFollowHints.tsx`, unchanged maths), `placeCards` (the same fan with the card size, kept inside a pane rectangle, a flag for the line back to the badge), card size constants. |
| `src/webview/canvas/gChord.ts` | create | Pure. `G_CHORD_MS`, `G_BADGES_ATTR`, `gChordStep`: what the key after `g` does. |
| `src/webview/canvas/PreviewCard.tsx` | create | One card: header, border, body. Code through shiki tokens, markdown through `useHostMarkdown` / `MarkdownRenderer`, image as `<img>`. |
| `src/webview/styles/preview-card.css` | create | Card rules for rendered markdown: no margins, one line per block. |
| `src/webview/canvas/palette.ts` | modify | `CARD_CODE_BORDER`, the code border on a card. |
| `src/webview/renderers/CodeRenderer.tsx` | modify | `useCodeTokens`: the preview's highlighter and theme as coloured runs per line. |
| `src/webview/hooks/useFileContent.ts` | modify | `loadedFileText`: a markdown file's text from the preview cache, without a request. |
| `src/webview/index.tsx` | modify | Import `preview-card.css`. |
| `src/webview/canvas/EdgeFollowHints.tsx` | modify | Draw badges, cards and lines; takes `ShownHints`. |
| `src/webview/canvas/CanvasView.tsx` | modify | Build cards in `connectionBadges`; chord without timer; capture listener while badges are shown; click closes. |
| `src/webview/canvas/nodes/CodeNode.tsx` | modify | Its capture key listener leaves the key alone while the badges are shown. |
| `tests/card-content.mjs` | create | One case per row of the spec's table, plus blank leading lines, a note without a heading, an image cell. |
| `tests/hint-placement.mjs` | create | Badge fan unchanged; cards keep order, do not overlap, stay in the pane, carry the line flag. |
| `tests/g-chord.mjs` | create | Badges past 1.5 s, Esc and other keys close, badge key jumps, 400 ms without connections. |

---

### Task 1: Card content, one rule per node type

**Files:**
- Create: `src/webview/canvas/cardContent.ts`
- Modify: `src/webview/canvas/palette.ts` (after `nodeBorderColor`, around line 41)
- Test: `tests/card-content.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/card-content.mjs`:

```js
// - run: npx esbuild src/webview/canvas/cardContent.ts --bundle --format=esm --outfile=tests/.build/cardContent.mjs && node --test tests/card-content.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cardContent, htmlLines, noteSnippet } from './.build/cardContent.mjs';

const base = { id: 'n', x: 0, y: 0, width: 400, height: 200 };

test('1. code: the first three non-empty lines, blank leading lines skipped', () => {
  const card = cardContent({ ...base, type: 'code', nodeLabel: 'E7', code: '\n\n   \nimport numpy as np\n\nx = 1\n    y = 2   \nz = 3' });
  assert.equal(card.label, 'E7');
  assert.equal(card.typeText, 'code · python');
  assert.deepEqual(card.body, { kind: 'code', lines: ['import numpy as np', 'x = 1', '    y = 2'], language: 'python' });
});

test('2. code: the default dark border is drawn lighter, a colour set on the node is kept', () => {
  assert.equal(cardContent({ ...base, type: 'code', code: 'x' }).border, '#3fb27f');
  assert.equal(cardContent({ ...base, type: 'code', code: 'x', accentColor: '#ff0000' }).border, '#ff0000');
  assert.equal(cardContent({ ...base, type: 'code', code: 'x', language: 'r' }).typeText, 'code · r');
});

test('3. note: the first heading in bold, then the next blocks as plain lines, a formula block kept whole', () => {
  const text = 'before the heading\n# Variation\n\nHow to find\n$$\n\\int_0^T x\\,dt\n$$\n- after the limit';
  const card = cardContent({ ...base, type: 'text', nodeLabel: 'N1', text });
  assert.equal(card.typeText, 'note');
  assert.equal(card.border, '#1f96bd');
  assert.deepEqual(card.body, { kind: 'markdown', text: '**Variation**\n\nHow to find\n\n$$\n\\int_0^T x\\,dt\n$$' });
});

test('4. note without a heading: its first three blocks, list and quote markers dropped', () => {
  assert.equal(noteSnippet('first\n\n- second\n> third\nfourth'), 'first\n\nsecond\n\nthird');
});

test('5. note: typst formulas stay as written, fenced code and rules are left out', () => {
  const text = '## T\n```python\n# not a heading\nx = 1\n```\n---\n%x^2%\n%%\nsum_(k=1) k\n%%';
  assert.equal(noteSnippet(text), '**T**\n\n%x^2%\n\n%%\nsum_(k=1) k\n%%');
});

test('6. file: the path, then the first heading once the preview has loaded the file', () => {
  const node = { ...base, type: 'file', nodeLabel: 'M1', file: 'Options/SC01_Continuous.md' };
  assert.deepEqual(cardContent(node).body, { kind: 'rows', rows: [{ text: 'Options/SC01_Continuous.md', style: 'path' }] });
  const card = cardContent(node, { fileText: '```\n# a comment\n```\n\n# Continuous processes\ntext' });
  assert.equal(card.typeText, 'file · md');
  assert.equal(card.border, '#de780b');
  assert.deepEqual(card.body.rows, [
    { text: 'Options/SC01_Continuous.md', style: 'path' },
    { text: 'Continuous processes', style: 'strong' },
  ]);
});

test('7. html output: the first lines of its text, tags removed, a table row on one line', () => {
  const html = '<style>.x { color: red }</style>\n<table>\n  <tr>\n    <th>a</th>\n    <th>b</th>\n  </tr>\n'
    + '  <tr><td>1</td><td>2 &amp; 3</td></tr>\n  <tr><td>4</td><td>5</td></tr>\n  <tr><td>6</td><td>7</td></tr>\n</table>';
  const card = cardContent({ ...base, type: 'cell', nodeLabel: 'C1', format: 'html', content: html }, { ownerLabel: 'E1' });
  assert.equal(card.typeText, 'output of E1');
  assert.deepEqual(card.body, { kind: 'rows', rows: [
    { text: 'a b', style: 'mono' }, { text: '1 2 & 3', style: 'mono' }, { text: '4 5', style: 'mono' },
  ] });
});

test('8. html output: a <pre> stream keeps its spacing and line breaks, its colour spans removed', () => {
  const html = '<pre class="skena-out-stream">   a  b\n<span style="color:red">0</span>  1  2\n\n1  3  4\n</pre>';
  assert.deepEqual(htmlLines(html), ['   a  b', '0  1  2', '1  3  4']);
});

test('9. markdown output: drawn as a note', () => {
  const card = cardContent({ ...base, type: 'cell', format: 'markdown', content: '# Result\nvalue 1' });
  assert.equal(card.typeText, 'cell · markdown');
  assert.deepEqual(card.body, { kind: 'markdown', text: '**Result**\n\nvalue 1' });
});

test('10. image output: the picture itself, to be fitted into the body', () => {
  const src = 'data:image/png;base64,iVBORw0KGgo=';
  const card = cardContent({ ...base, type: 'cell', format: 'image', content: src }, { ownerLabel: 'E3' });
  assert.equal(card.typeText, 'output of E3');
  assert.deepEqual(card.body, { kind: 'image', src });
});

test('11. plotly output: the word plot', () => {
  assert.deepEqual(
    cardContent({ ...base, type: 'cell', format: 'plotly', content: '{"data":[]}' }).body,
    { kind: 'rows', rows: [{ text: 'plot', style: 'plain' }] },
  );
});

test('12. knowledge: the title, then the source', () => {
  const card = cardContent({
    ...base, type: 'knowledge', nodeLabel: 'W1', server: 'crtx', uri: 'experiments/trinity-reversal.md',
    title: 'Trinity reversal', text: 'body', fetchedAt: '2026-09-25T00:00:00Z',
  });
  assert.equal(card.typeText, 'knowledge');
  assert.equal(card.border, '#3b9ad9');
  assert.deepEqual(card.body.rows, [
    { text: 'Trinity reversal', style: 'strong' },
    { text: 'experiments/trinity-reversal.md', style: 'path' },
  ]);
});

test('13. any other type: what its own header shows', () => {
  const link = cardContent({ ...base, type: 'link', url: 'https://example.com/a' });
  assert.equal(link.typeText, 'link');
  assert.deepEqual(link.body.rows, [{ text: 'https://example.com/a', style: 'path' }]);
  assert.deepEqual(
    cardContent({ ...base, type: 'portal', canvas: 'sub/Other.canvas', label: 'Other' }).body.rows,
    [{ text: 'Other', style: 'strong' }, { text: 'sub/Other.canvas', style: 'path' }],
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx esbuild src/webview/canvas/cardContent.ts --bundle --format=esm --outfile=tests/.build/cardContent.mjs && node --test tests/card-content.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/webview/canvas/cardContent.ts"`.

- [ ] **Step 3: Add the card's code border to the palette**

In `src/webview/canvas/palette.ts`, replace:

```ts
  return accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE[type as keyof typeof DEFAULT_NODE_BORDER_BY_TYPE];
}
```

with:

```ts
  return accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE[type as keyof typeof DEFAULT_NODE_BORDER_BY_TYPE];
}

// - a code node's border on a `g` preview card: the default above is too dark on the card background
export const CARD_CODE_BORDER = '#3fb27f';
```

`#3fb27f` is the code border the user saw in the mock. `lighten('#02542e', 0.36)` gives `#06e980` instead, because `lighten` keeps the saturation; do not use it here.

- [ ] **Step 4: Write the module**

Create `src/webview/canvas/cardContent.ts`:

```ts
import type { CanvasNode, CellNode } from '../../shared/types';
import { CARD_CODE_BORDER, nodeBorderColor } from './palette';

// - a card body shows at most this many lines
export const CARD_LINES = 3;

/** One line of a card body that is not code, markdown or a picture. */
export interface CardRow { text: string; style: 'strong' | 'path' | 'plain' | 'mono' }

export type CardBody =
  | { kind: 'code'; lines: string[]; language: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'rows'; rows: CardRow[] }
  | { kind: 'image'; src: string };

/** What the card of one node shows: its label and type in the header, its border, and its body. */
export interface CardContent {
  label?: string;
  typeText: string;
  border: string;
  body: CardBody;
}

/** What a card needs beyond the node itself. */
export interface CardExtra {
  /** - the label of the code cell whose output this cell is */
  ownerLabel?: string;
  /** - the text of a markdown file, when its file preview has already loaded it */
  fileText?: string;
}

const FENCE = /^(```|~~~)/;
// - a formula block opens with one of these alone on a line and closes with its pair
const MATH_CLOSE: Record<string, string> = { '$$': '$$', '%%': '%%', '\\[': '\\]' };
// - a thematic break: three or more of one of - * _
const RULE = /^([-*_])(\s*\1){2,}$/;

/**
 * The blocks of a markdown text in reading order, one string each: a line of prose, or a whole
 * formula block with its delimiters. Blank lines, rules and fenced code are left out.
 */
function mdBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || RULE.test(t)) continue;
    if (FENCE.test(t)) {
      const mark = t.slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) i++;
      continue;
    }
    const close = MATH_CLOSE[t];
    if (close !== undefined) {
      const block = [t];
      i++;
      while (i < lines.length && lines[i].trim() !== close) block.push(lines[i++]);
      block.push(close);
      out.push(block.join('\n'));
      continue;
    }
    out.push(t);
  }
  return out;
}

function headingText(block: string): string | undefined {
  const m = /^#{1,6}\s+(.+)$/.exec(block);
  return m ? m[1].trim() : undefined;
}

// - heading, quote and list markers go, so each block renders as one plain line
const plainLine = (block: string): string =>
  block.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');

/**
 * The markdown a note's card renders: the first heading in bold, then the blocks after it as plain
 * lines, CARD_LINES in all. A note with no heading shows its first CARD_LINES blocks.
 */
export function noteSnippet(text: string): string {
  const blocks = mdBlocks(text);
  const at = blocks.findIndex(b => headingText(b) !== undefined);
  const picked = at < 0
    ? blocks.slice(0, CARD_LINES).map(plainLine)
    : [`**${headingText(blocks[at])}**`, ...blocks.slice(at + 1, at + CARD_LINES).map(plainLine)];
  return picked.join('\n\n');
}

/** The text of the first heading of a markdown text, outside fenced code. */
export function firstHeading(text: string): string | undefined {
  for (const b of mdBlocks(text)) {
    const h = headingText(b);
    if (h !== undefined) return h;
  }
  return undefined;
}

// - ends of blocks a browser starts a new line after
const BLOCK_END = /<\/(p|div|tr|li|h[1-6]|table|thead|tbody|ul|ol|blockquote)>|<br\s*\/?>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The lines of text an html output shows, tags removed, blank lines dropped. Inside `<pre>` the
 * spacing and the line breaks are kept; elsewhere whitespace folds as a browser folds it, a table
 * row reads as one line with its cells one space apart.
 */
export function htmlLines(html: string): string[] {
  const cleaned = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const parts = cleaned.split(/(<pre\b[\s\S]*?<\/pre>)/i);
  const lines: string[] = [];
  parts.forEach((part, i) => {
    const pre = i % 2 === 1;
    const text = pre
      ? part.replace(/<[^>]*>/g, '')
      : part.replace(/\s+/g, ' ').replace(BLOCK_END, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]*>/g, '').replace(/ {2,}/g, ' ');
    for (const line of decodeEntities(text).split('\n')) {
      const kept = pre ? line.trimEnd() : line.trim();
      if (kept.trim() !== '') lines.push(kept);
    }
  });
  return lines;
}

function extOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function cardBorder(node: CanvasNode & { accentColor?: string }): string {
  // - the default code border is too dark to see on the card background
  if (node.type === 'code' && node.accentColor === undefined) return CARD_CODE_BORDER;
  return nodeBorderColor(node.type, node.accentColor);
}

function cellBody(node: CellNode): CardBody {
  switch (node.format) {
    case 'image':    return { kind: 'image', src: node.content };
    case 'markdown': return { kind: 'markdown', text: noteSnippet(node.content) };
    case 'plotly':   return { kind: 'rows', rows: [{ text: 'plot', style: 'plain' }] };
    case 'html':     return { kind: 'rows', rows: htmlLines(node.content).slice(0, CARD_LINES).map(text => ({ text, style: 'mono' })) };
  }
}

// - what the node's own header shows: its title, file or URL
function headerRows(node: CanvasNode): CardRow[] {
  switch (node.type) {
    case 'link':
      return [{ text: node.url, style: 'path' }];
    case 'portal':
      return node.label
        ? [{ text: node.label, style: 'strong' }, { text: node.canvas, style: 'path' }]
        : [{ text: node.canvas, style: 'path' }];
    case 'noderef': {
      const rows: CardRow[] = [{ text: `${node.canvas} › ${node.label}`, style: 'path' }];
      if (node.title) rows.push({ text: node.title, style: 'plain' });
      return rows;
    }
    case 'chat':
      return [{ text: node.title, style: 'strong' }];
    case 'kernel':
      return [{ text: node.displayName ?? 'kernel', style: 'strong' }, { text: node.server, style: 'path' }];
    case 'group':
      return node.label ? [{ text: node.label, style: 'strong' }] : [];
    default:
      return [];
  }
}

/**
 * The card `g` shows for `node`, the node at the other end of a connection. Built from the data the
 * webview already holds; nothing is fetched.
 */
export function cardContent(node: CanvasNode & { accentColor?: string }, extra: CardExtra = {}): CardContent {
  const head = { label: node.nodeLabel, border: cardBorder(node) };
  switch (node.type) {
    case 'code': {
      const language = node.language ?? 'python';
      const lines = node.code.split(/\r?\n/).filter(l => l.trim() !== '').slice(0, CARD_LINES).map(l => l.trimEnd());
      return { ...head, typeText: `code · ${language}`, body: { kind: 'code', lines, language } };
    }
    case 'text':
      return { ...head, typeText: 'note', body: { kind: 'markdown', text: noteSnippet(node.text) } };
    case 'file': {
      const ext = extOf(node.file);
      const heading = extra.fileText === undefined ? undefined : firstHeading(extra.fileText);
      const rows: CardRow[] = [{ text: node.file, style: 'path' }];
      if (heading !== undefined) rows.push({ text: heading, style: 'strong' });
      return { ...head, typeText: ext ? `file · ${ext}` : 'file', body: { kind: 'rows', rows } };
    }
    case 'cell':
      return {
        ...head,
        typeText: extra.ownerLabel ? `output of ${extra.ownerLabel}` : `cell · ${node.format}`,
        body: cellBody(node),
      };
    case 'knowledge':
      return {
        ...head,
        typeText: 'knowledge',
        body: { kind: 'rows', rows: [{ text: node.title, style: 'strong' }, { text: node.uri, style: 'path' }] },
      };
    default:
      return { ...head, typeText: node.type, body: { kind: 'rows', rows: headerRows(node) } };
  }
}
```

- [ ] **Step 5: Run the test and see it pass**

Run: `npx esbuild src/webview/canvas/cardContent.ts --bundle --format=esm --outfile=tests/.build/cardContent.mjs && node --test tests/card-content.mjs`

Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/webview/canvas/cardContent.ts src/webview/canvas/palette.ts tests/card-content.mjs
git commit -m "feat: card content for the node a g badge leads to, one rule per node type"
```

---

### Task 2: Placement of badges and cards

**Files:**
- Create: `src/webview/canvas/hintPlacement.ts`
- Modify: `src/webview/canvas/EdgeFollowHints.tsx` (whole file)
- Test: `tests/hint-placement.mjs`

`place()` moves out of `EdgeFollowHints.tsx` into the pure module as `placeBadges`, with the same maths. Its result names the badge centre `cx` / `cy` (it was `left` / `top`, which read as a corner).

- [ ] **Step 1: Write the failing test**

Create `tests/hint-placement.mjs`:

```js
// - run: npx esbuild src/webview/canvas/hintPlacement.ts --bundle --format=esm --outfile=tests/.build/hintPlacement.mjs && node --test tests/hint-placement.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BADGE_HALF, CARD_GAP, CARD_H, CARD_W, PANE_MARGIN, placeBadges, placeCards } from './.build/hintPlacement.mjs';

const PANE = { left: 0, top: 0, right: 2000, bottom: 1200 };
// - a badge already placed on screen, centred on (cx, cy)
const badge = (key, side, cx, cy) => ({ hint: { key, label: key, x: 0, y: 0, side }, cx, cy, ex: cx, ey: cy, lead: false });

test('1. badges: two exit points at one spot fan 16 px apart on screen and stay centred on it', () => {
  const hints = [
    { key: 'a', label: 'l', x: 100, y: 50, side: 'right' },
    { key: 'b', label: '1', x: 100, y: 50, side: 'right' },
  ];
  // - flow (100, 50) at zoom 2, shifted (10, 20): screen (210, 120); the badge sits 8 px outside
  const [a, b] = placeBadges(hints, 10, 20, 2);
  assert.equal(a.cx, 218);
  assert.equal(b.cy - a.cy, 16);
  assert.equal((a.cy + b.cy) / 2, 120);
  assert.ok(a.lead && b.lead);
});

test('2. cards of one border keep the badge order, do not overlap, and stay centred on their badges', () => {
  const cards = placeCards([badge('a', 'right', 500, 590), badge('b', 'right', 500, 600), badge('c', 'right', 500, 610)], PANE);
  assert.deepEqual(cards.map(c => c.key), ['a', 'b', 'c']);
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].top >= cards[i - 1].top + CARD_H);
  const centre = cards.reduce((s, c) => s + c.top + CARD_H / 2, 0) / cards.length;
  assert.ok(Math.abs(centre - 600) < 1e-9);
});

test('3. a card sits just outside its badge, away from the node, on every border', () => {
  const off = BADGE_HALF + CARD_GAP;
  const [r] = placeCards([badge('r', 'right', 500, 600)], PANE);
  assert.equal(r.left, 500 + off);
  const [l] = placeCards([badge('l', 'left', 500, 600)], PANE);
  assert.equal(l.left + CARD_W, 500 - off);
  const [b] = placeCards([badge('b', 'bottom', 500, 600)], PANE);
  assert.equal(b.top, 600 + off);
  const [t] = placeCards([badge('t', 'top', 500, 600)], PANE);
  assert.equal(t.top + CARD_H, 600 - off);
  assert.ok([r, l, b, t].every(c => !c.lead));
});

test('4. cards stay inside the pane: pushed in near its edges', () => {
  const pane = { left: 0, top: 0, right: 800, bottom: 600 };
  const [r] = placeCards([badge('r', 'right', 780, 20)], pane);
  assert.equal(r.left, 800 - PANE_MARGIN - CARD_W);
  assert.equal(r.top, PANE_MARGIN);
  const run = placeCards([badge('a', 'bottom', 700, 100), badge('b', 'bottom', 710, 100), badge('c', 'bottom', 720, 100)], pane);
  assert.ok(run.every(c => c.left >= PANE_MARGIN && c.left + CARD_W <= 800 - PANE_MARGIN));
  for (let i = 1; i < run.length; i++) assert.ok(run[i].left >= run[i - 1].left + CARD_W);
  // - a pane whose left part the floating chat covers
  const [l] = placeCards([badge('l', 'left', 320, 300)], { left: 300, top: 0, right: 1200, bottom: 600 });
  assert.equal(l.left, 300 + PANE_MARGIN);
  // - a run longer than the pane keeps its start inside
  const long = placeCards([badge('a', 'right', 100, 50), badge('b', 'right', 100, 60)], { left: 0, top: 0, right: 800, bottom: 150 });
  assert.equal(long[0].top, PANE_MARGIN);
});

test('5. a card moved off its badge is marked for a line back to it; one still beside it is not', () => {
  const cards = placeCards([badge('a', 'right', 500, 600), badge('b', 'right', 500, 600), badge('c', 'right', 500, 600)], PANE);
  assert.deepEqual(cards.map(c => c.lead), [true, false, true]);
  const a = cards[0];
  assert.deepEqual([a.bx, a.by], [500, 600]);
  // - the line ends on the card's nearest corner: the bottom-left one, since the card moved up
  assert.deepEqual([a.lx, a.ly], [a.left, a.top + CARD_H]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx esbuild src/webview/canvas/hintPlacement.ts --bundle --format=esm --outfile=tests/.build/hintPlacement.mjs && node --test tests/hint-placement.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/webview/canvas/hintPlacement.ts"`.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/hintPlacement.ts`:

```ts
import type { Side } from '../../shared/edgeRouting';
import type { Rect } from './spatialNav';

/** One badge: the key to press after `g`, at the point its connection meets the border. */
export interface EdgeHint { key: string; label: string; x: number; y: number; side: Side }

// - px the badge centre sits outside the border, so it does not cover the exit point it names
const OUT = 8;
// - the badge is a 14 px box and does not scale, while the exit points are 10 flow px apart and do;
//   below zoom 1 they never fit, so the fan keeps at least this much between two badge centres
const MIN_GAP = 16;
// - under this the badge still covers its own exit point, so a line to it would only add clutter
const LEAD_MIN = 4;
// - half the 14 px badge box
export const BADGE_HALF = 7;

export const CARD_W = 228;
export const CARD_HEADER_H = 20;
export const CARD_BODY_H = 58;
export const CARD_BORDER = 1.5;
export const CARD_H = CARD_HEADER_H + CARD_BODY_H + 2 * CARD_BORDER;
// - between a badge and its card, and between two cards of one border
export const CARD_GAP = 6;
// - the closest a card comes to the edge of the pane
export const PANE_MARGIN = 8;

/** A badge on screen, in pane pixels: its centre, the exit point it names, and whether a line joins them. */
export interface PlacedBadge { hint: EdgeHint; cx: number; cy: number; ex: number; ey: number; lead: boolean }

/**
 * A card on screen, in pane pixels: its top-left corner, and the line from its badge's centre
 * (bx, by) to the nearest point of the card (lx, ly), drawn when `lead` is set.
 */
export interface PlacedCard { key: string; left: number; top: number; lead: boolean; bx: number; by: number; lx: number; ly: number }

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

function groupBySide<T>(items: T[], sideOf: (t: T) => Side): Map<Side, T[]> {
  const m = new Map<Side, T[]>();
  for (const t of items) {
    const list = m.get(sideOf(t));
    if (list) list.push(t); else m.set(sideOf(t), [t]);
  }
  return m;
}

// - positions along one border in their given order, each at least `step` after the one before,
//   then all moved by one amount so their mean is the mean of the input
function fan(axis: number[], step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < axis.length; i++) out.push(i === 0 ? axis[i] : Math.max(axis[i], out[i - 1] + step));
  const shift = mean(axis) - mean(out);
  return out.map(a => a + shift);
}

/**
 * Where each badge is drawn, in pane pixels. The badges of one border keep their slot order and are
 * pushed apart only where their exit points are closer together than one badge; the run is then slid
 * back so it stays centred on the points it names. Fanning happens on screen, not in flow
 * coordinates, because the badge is a fixed pixel size and the exit points are not.
 */
export function placeBadges(hints: EdgeHint[], tx: number, ty: number, zoom: number): PlacedBadge[] {
  const out: PlacedBadge[] = [];
  for (const [side, list] of groupBySide(hints, h => h.side)) {
    // - `along` is the coordinate that runs along the border, the one the fan opens on
    const along = side === 'left' || side === 'right' ? 'y' : 'x';
    const pts = list.map(h => ({ x: h.x * zoom + tx, y: h.y * zoom + ty }));
    const axis = pts.map(p => p[along]);
    const at = fan(axis, MIN_GAP);
    const outward = side === 'right' || side === 'bottom' ? OUT : -OUT;
    list.forEach((hint, i) => out.push({
      hint,
      cx: along === 'y' ? pts[i].x + outward : at[i],
      cy: along === 'y' ? at[i] : pts[i].y + outward,
      ex: pts[i].x, ey: pts[i].y,
      lead: Math.abs(at[i] - axis[i]) > LEAD_MIN,
    }));
  }
  return out;
}

/**
 * Where each card is drawn, in pane pixels: just outside its badge, on the side away from the
 * focused node. The cards of one border keep the badges' order, are pushed apart until they do not
 * overlap and are slid back to stay centred on their badges: the badges' fan with the card's size.
 * The run is then moved inside `area`, and each card pushed in across the border; where a run is
 * longer than the area its start stays in. A card whose badge is no longer beside it is marked for a
 * line back to the badge.
 */
export function placeCards(badges: PlacedBadge[], area: Rect): PlacedCard[] {
  const out: PlacedCard[] = [];
  const off = BADGE_HALF + CARD_GAP;
  for (const [side, list] of groupBySide(badges, b => b.hint.side)) {
    const vertical = side === 'left' || side === 'right';
    const size = vertical ? CARD_H : CARD_W;
    const lo = (vertical ? area.top : area.left) + PANE_MARGIN;
    const hi = (vertical ? area.bottom : area.right) - PANE_MARGIN;
    const at = fan(list.map(b => (vertical ? b.cy : b.cx)), size + CARD_GAP);
    let shift = 0;
    const end = at[at.length - 1] + size / 2;
    if (end > hi) shift = hi - end;
    const start = at[0] + shift - size / 2;
    if (start < lo) shift += lo - start;
    list.forEach((b, i) => {
      const a = at[i] + shift - size / 2;
      const left = vertical
        ? clamp(side === 'right' ? b.cx + off : b.cx - off - CARD_W, area.left + PANE_MARGIN, area.right - PANE_MARGIN - CARD_W)
        : a;
      const top = vertical
        ? a
        : clamp(side === 'bottom' ? b.cy + off : b.cy - off - CARD_H, area.top + PANE_MARGIN, area.bottom - PANE_MARGIN - CARD_H);
      const lx = clamp(b.cx, left, left + CARD_W);
      const ly = clamp(b.cy, top, top + CARD_H);
      out.push({ key: b.hint.key, left, top, bx: b.cx, by: b.cy, lx, ly, lead: Math.hypot(b.cx - lx, b.cy - ly) > off + LEAD_MIN });
    });
  }
  return out;
}
```

The card is 228 px wide and 81 px tall: 20 px header, 58 px body, a 1.5 px border on each side. `PreviewCard` (Task 3) draws it from the same constants.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx esbuild src/webview/canvas/hintPlacement.ts --bundle --format=esm --outfile=tests/.build/hintPlacement.mjs && node --test tests/hint-placement.mjs`

Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Draw the badges through `placeBadges`**

Replace the whole of `src/webview/canvas/EdgeFollowHints.tsx` with:

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import { placeBadges, type EdgeHint } from './hintPlacement';

export type { EdgeHint } from './hintPlacement';

const FONT = 'system-ui, -apple-system, sans-serif';

/**
 * The labels shown while the `g` chord is armed, one per connection of the focused node, on all four
 * borders. Same layer as the section separators: a pointer-transparent overlay over the pane, with
 * the flow coordinates projected through React Flow's own transform. A badge the fan moved off its
 * own exit point keeps a line back to it.
 */
export function EdgeFollowHints({ hints }: { hints: EdgeHint[] }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (hints.length === 0) return null;
  const placed = placeBadges(hints, tx, ty, zoom);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {placed.filter(p => p.lead).map(p => (
          <line key={p.hint.key} x1={p.ex} y1={p.ey} x2={p.cx} y2={p.cy}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
      </svg>
      {placed.map(p => (
        <div
          key={p.hint.key}
          style={{
            position: 'absolute', left: p.cx, top: p.cy, transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {p.hint.label}
        </div>
      ))}
    </div>
  );
}
```

`CanvasView.tsx` still imports `type EdgeHint` from `./EdgeFollowHints`; the re-export keeps that import valid.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/hintPlacement.ts src/webview/canvas/EdgeFollowHints.tsx tests/hint-placement.mjs
git commit -m "feat: g badge and card placement as pure functions; cards fan along their border and stay inside the pane"
```

---

### Task 3: The card component

**Files:**
- Create: `src/webview/canvas/PreviewCard.tsx`
- Create: `src/webview/styles/preview-card.css`
- Modify: `src/webview/renderers/CodeRenderer.tsx` (line 10 import; append at the end)
- Modify: `src/webview/index.tsx:45`

The card has no unit test: the tests run in node without a DOM. Typecheck and build check it here; Task 6 checks it by eye.

How each body is drawn, and why:
- **Code:** the code preview in `CodeNode` uses shiki through `CodeRenderer`, not Monaco. The card takes the same highlighter and theme as coloured runs (`codeToTokensBase`) and draws its own lines. So no Monaco editor is created, and shiki's `<pre>` background does not show on the card.
- **Markdown:** the same path a note takes in `TextNode.tsx:998-1000`. `useHostMarkdown` sends a text holding `%` (typst) to the host for rendering; any other text goes to `MarkdownRenderer`, which draws LaTeX with KaTeX.
- **Image:** the cell's data URI in an `<img>` with `object-fit: contain`, as `CellNode` draws it.

- [ ] **Step 1: Add `useCodeTokens` to `CodeRenderer.tsx`**

In `src/webview/renderers/CodeRenderer.tsx`, replace line 10:

```ts
import { createHighlighter, Highlighter } from 'shiki';
```

with:

```ts
import { createHighlighter, Highlighter, type BundledLanguage, type BundledTheme } from 'shiki';
```

Then append at the end of the file:

```tsx

/** One coloured run of a highlighted line. */
export interface CodeToken { content: string; color?: string; italic: boolean }

/**
 * `content` split into lines of coloured runs, with the highlighter and theme the code preview uses,
 * for a caller that draws its own lines. Null until the highlighter is ready, or when it does not
 * know `language`.
 */
export function useCodeTokens(content: string, language: string): CodeToken[][] | null {
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const theme = document.documentElement.dataset.mdTheme === 'factors' ? 'factors' : 'dark-plus';
    getHighlighter().then(hl => {
      if (cancelled) return;
      // - the typed options list shiki's bundled names only; `factors` is registered by object above
      const lines = hl.codeToTokensBase(content, { lang: language as BundledLanguage, theme: theme as BundledTheme });
      // - fontStyle is a bit set, and -1 when the theme sets none
      setTokens(lines.map(line => line.map(t => {
        const style = Number(t.fontStyle ?? 0);
        return { content: t.content, color: t.color, italic: style > 0 && (style & 1) === 1 };
      })));
    }).catch(() => { if (!cancelled) setTokens(null); });
    return () => { cancelled = true; };
  }, [content, language, themeTick]);

  return tokens;
}
```

The casts are needed: `codeToTokensBase` types `lang` and `theme` as shiki's bundled names only, while `codeToHtml` above accepts any string.

- [ ] **Step 2: Create the card stylesheet**

Create `src/webview/styles/preview-card.css`:

```css
/* - a g preview card: the body holds at most three lines, so a rendered note loses the margins and
   - the line height it has inside a node, and every block stays on one line. !important because the
   - factors theme sets these through a more specific selector. */
.skena-preview-card .skena-markdown {
  font-size: 11.5px !important;
  line-height: 1.35 !important;
}
.skena-preview-card .skena-markdown > * {
  margin: 0 !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skena-preview-card .katex-display { margin: 0 !important; text-align: left; }
.skena-preview-card .typst-math.typst-block { margin: 0 !important; }
```

- [ ] **Step 3: Load it**

In `src/webview/index.tsx`, replace:

```ts
import './styles/markdown.css';
```

with:

```ts
import './styles/markdown.css';
import './styles/preview-card.css';
```

It must come after `markdown.css`, whose `.skena-markdown p` margins it overrides.

- [ ] **Step 4: Write the component**

Create `src/webview/canvas/PreviewCard.tsx`:

```tsx
import React, { memo } from 'react';
import type { CardBody, CardContent, CardRow } from './cardContent';
import { CARD_BODY_H, CARD_BORDER, CARD_H, CARD_HEADER_H, CARD_W } from './hintPlacement';
import { MarkdownRenderer } from '../renderers/MarkdownRenderer';
import { useCodeTokens } from '../renderers/CodeRenderer';
import { useHostMarkdown } from '../hooks/useHostMarkdown';

const FONT = 'system-ui, -apple-system, sans-serif';
const MONO = 'var(--vscode-editor-font-family, monospace)';
const ONE_LINE: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const ROW_STYLE: Record<CardRow['style'], React.CSSProperties> = {
  strong: { ...ONE_LINE, fontWeight: 700, fontSize: 12 },
  path:   { ...ONE_LINE, fontFamily: MONO, fontSize: 10.5, color: 'var(--sk-text2)' },
  plain:  ONE_LINE,
  mono:   { ...ONE_LINE, whiteSpace: 'pre', fontFamily: MONO, fontSize: 10.5 },
};

// - plain text until the highlighter has coloured the lines
function CodeBody({ lines, language }: { lines: string[]; language: string }): JSX.Element {
  const tokens = useCodeTokens(lines.join('\n'), language);
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: '15px' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ ...ONE_LINE, whiteSpace: 'pre' }}>
          {tokens?.[i]
            ? tokens[i].map((t, j) => (
              <span key={j} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>{t.content}</span>
            ))
            : line}
        </div>
      ))}
    </div>
  );
}

// - the path a note takes: the host renders a text holding typst (`%`), the webview renders the rest
function MarkdownBody({ text }: { text: string }): JSX.Element {
  const hostHtml = useHostMarkdown(text);
  return hostHtml !== null
    ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: hostHtml }} />
    : <MarkdownRenderer content={text} baseUri="." />;
}

function Body({ body }: { body: CardBody }): JSX.Element {
  switch (body.kind) {
    case 'code':
      return <CodeBody lines={body.lines} language={body.language} />;
    case 'markdown':
      return <MarkdownBody text={body.text} />;
    case 'image':
      return <img src={body.src} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />;
    case 'rows':
      return <>{body.rows.map((r, i) => <div key={i} style={ROW_STYLE[r.style]}>{r.text}</div>)}</>;
  }
}

/**
 * The card of the node a `g` badge leads to: its label and type on top, then at most three lines of
 * what it holds. A fixed screen size: it does not scale with the canvas zoom.
 */
export const PreviewCard = memo(function PreviewCard({ card }: { card: CardContent }): JSX.Element {
  return (
    <div
      className="skena-preview-card"
      style={{
        width: CARD_W, height: CARD_H, boxSizing: 'border-box', overflow: 'hidden',
        border: `${CARD_BORDER}px solid ${card.border}`, borderRadius: 6,
        background: 'var(--sk-bg2)', color: 'var(--sk-text1)', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
        fontFamily: FONT, fontSize: 11.5, lineHeight: 1.35,
      }}
    >
      <div style={{
        height: CARD_HEADER_H, boxSizing: 'border-box', padding: '0 7px', borderBottom: '1px solid var(--sk-border)',
        display: 'flex', alignItems: 'center', gap: 5, ...ONE_LINE,
      }}>
        {card.label && <span style={{ fontWeight: 700, fontSize: 11 }}>{card.label}</span>}
        {card.label && <span style={{ color: 'var(--sk-text2)' }}>·</span>}
        <span style={{ ...ONE_LINE, fontSize: 10.5, color: 'var(--sk-text2)' }}>{card.typeText}</span>
      </div>
      <div style={{ height: CARD_BODY_H, boxSizing: 'border-box', padding: '5px 8px 6px', overflow: 'hidden' }}>
        <Body body={card.body} />
      </div>
    </div>
  );
});
```

The header reads `E7 · code · python` or `C1 · output of E1`, as in the spec.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`

Expected: no output.

- [ ] **Step 6: Build**

Run: `npm run build`

Expected: no `✘ [ERROR]` line; the last lines list `dist/webview.js` and `dist/webview.css`. Then `grep -c "skena-preview-card" dist/webview.css` prints `4`.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/PreviewCard.tsx src/webview/styles/preview-card.css src/webview/renderers/CodeRenderer.tsx src/webview/index.tsx
git commit -m "feat: g preview card: code in the preview colours without Monaco, markdown with math, image thumbnail"
```

---

### Task 4: `EdgeFollowHints` draws the cards

**Files:**
- Modify: `src/webview/hooks/useFileContent.ts` (append)
- Modify: `src/webview/canvas/EdgeFollowHints.tsx` (whole file)
- Modify: `src/webview/canvas/CanvasView.tsx` (6 replacements: import line 60, state near line 544, `connectionBadges` near line 2445, `armG` / `disarmG` near line 2466, the effect cleanup near line 3232, the render near line 4051)

After this task the cards appear with the badges. The old 1.5 s timer still closes them; Task 5 removes it.

- [ ] **Step 1: Read a loaded file's text without a request**

Append to `src/webview/hooks/useFileContent.ts`:

```ts

/** - the text of a markdown file an open preview has already loaded; nothing is fetched */
export function loadedFileText(uri: string): string | undefined {
  const hit = cache.get(normalizeUri(uri));
  return hit?.status === 'loaded' && hit.fileType === 'markdown' ? hit.content : undefined;
}
```

`FileNode` loads with `useFileContent(node.file)`, so `node.file` is the cache key here too.

- [ ] **Step 2: Draw badges, cards and lines**

Replace the whole of `src/webview/canvas/EdgeFollowHints.tsx` with:

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import type { CardContent } from './cardContent';
import { placeBadges, placeCards, type EdgeHint } from './hintPlacement';
import { PreviewCard } from './PreviewCard';
import type { Rect } from './spatialNav';

export type { EdgeHint } from './hintPlacement';

/**
 * What `g` puts on screen: one badge per connection of the focused node, the card of the node each
 * badge leads to (keyed by the badge's key), and the part of the pane the cards stay inside.
 */
export interface ShownHints { hints: EdgeHint[]; cards: ReadonlyMap<string, CardContent>; area: Rect }

const FONT = 'system-ui, -apple-system, sans-serif';

/**
 * The badges shown while the `g` chord is armed, one per connection of the focused node, on all four
 * borders, each with the card of the node its connection leads to. Same layer as the section
 * separators: a pointer-transparent overlay over the pane, with the flow coordinates projected
 * through React Flow's own transform. A badge the fan moved off its own exit point, or a card moved
 * off its badge, keeps a line back to it. The badges are drawn over the cards.
 */
export function EdgeFollowHints({ shown }: { shown: ShownHints | null }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (shown === null || shown.hints.length === 0) return null;
  const badges = placeBadges(shown.hints, tx, ty, zoom);
  const cards = placeCards(badges.filter(b => shown.cards.has(b.hint.key)), shown.area);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {badges.filter(b => b.lead).map(b => (
          <line key={`b:${b.hint.key}`} x1={b.ex} y1={b.ey} x2={b.cx} y2={b.cy}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
        {cards.filter(c => c.lead).map(c => (
          <line key={`c:${c.key}`} x1={c.bx} y1={c.by} x2={c.lx} y2={c.ly}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
      </svg>
      {cards.map(c => {
        const card = shown.cards.get(c.key);
        return card && (
          <div key={c.key} style={{ position: 'absolute', left: c.left, top: c.top }}>
            <PreviewCard card={card} />
          </div>
        );
      })}
      {badges.map(b => (
        <div
          key={b.hint.key}
          style={{
            position: 'absolute', left: b.cx, top: b.cy, transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {b.hint.label}
        </div>
      ))}
    </div>
  );
}
```

Cards are drawn before the badges, so a card pushed over its badge does not hide the key.

- [ ] **Step 3: Build the cards in `CanvasView.tsx`**

Make these six replacements in `src/webview/canvas/CanvasView.tsx`. Each old block occurs once.

3a. Imports. Replace:

```tsx
import { EdgeFollowHints, type EdgeHint } from './EdgeFollowHints';
```

with:

```tsx
import { EdgeFollowHints, type EdgeHint, type ShownHints } from './EdgeFollowHints';
import { cardContent, type CardContent } from './cardContent';
import { loadedFileText } from '../hooks/useFileContent';
```

3b. State. Replace:

```tsx
  // - the labels drawn over the focused node's borders; only while the chord is armed
  const [gHints, setGHints] = useState<EdgeHint[]>([]);
```

with:

```tsx
  // - the badges drawn over the focused node's borders and the card of the node each one leads to;
  //   only while the chord is armed
  const [gShown, setGShown] = useState<ShownHints | null>(null);
```

3c. `connectionBadges`: also build the card of each connected node. `shownArea` gives the pane rectangle the cards stay inside; `paneArea` (line 120) already cuts off the floating chat. Replace:

```tsx
    /**
     * What `g` puts on screen and what the next key means: one badge per connection of the focused
     * node, on all four borders, carrying the key that follows it (see `connectionLabels`). A
     * connection the routing pass did not route has no exit point of its own; its badge is spread
     * along the border the way the router spreads the ones it does route.
     */
    const connectionBadges = (): { hints: EdgeHint[]; byLabel: Map<string, string> } => {
      const from = focusedNode();
      if (!from) return { hints: [], byLabel: new Map() };
      const geom = toNav(from);
      const labels = connectionLabels(geom, sideContext());
      const bySide = new Map<Side, ConnectionLabel[]>();
      for (const c of labels) {
        const list = bySide.get(c.side);
        if (list) list.push(c); else bySide.set(c.side, [c]);
      }
      const hints: EdgeHint[] = [];
      for (const [side, list] of bySide) list.forEach((c, i) => {
        const at = c.at ?? borderPoint(geom, side, (i - (list.length - 1) / 2) * LANE_STEP);
        hints.push({ key: `${side}:${c.edgeId ?? c.nodeId}`, label: c.label, x: at[0], y: at[1], side });
      });
      return { hints, byLabel: new Map(labels.map(c => [c.label, c.nodeId])) };
    };
```

with:

```tsx
    // - the card of one node, from what the webview already holds: the node, the code cell whose
    //   output it is, and a markdown file's text once its preview has loaded it
    const cardOf = (id: string): CardContent | undefined => {
      const n = nodesRef.current.find(m => m.id === id);
      if (!n) return undefined;
      const node = n.data as unknown as CanvasNode & { accentColor?: string };
      const owner = node.type === 'cell'
        ? nodesRef.current.find(m => (m.data as { outputNodeId?: string }).outputNodeId === id)
        : undefined;
      return cardContent(node, {
        ownerLabel: (owner?.data as { nodeLabel?: string } | undefined)?.nodeLabel,
        fileText: node.type === 'file' ? loadedFileText(node.file) : undefined,
      });
    };

    /**
     * What `g` puts on screen and what the next key means: one badge per connection of the focused
     * node, on all four borders, carrying the key that follows it (see `connectionLabels`), and the
     * card of the node each badge leads to, under the badge's key. A connection the routing pass did
     * not route has no exit point of its own; its badge is spread along the border the way the
     * router spreads the ones it does route.
     */
    const connectionBadges = (): { hints: EdgeHint[]; byLabel: Map<string, string>; cards: Map<string, CardContent> } => {
      const cards = new Map<string, CardContent>();
      const from = focusedNode();
      if (!from) return { hints: [], byLabel: new Map(), cards };
      const geom = toNav(from);
      const labels = connectionLabels(geom, sideContext());
      const bySide = new Map<Side, ConnectionLabel[]>();
      for (const c of labels) {
        const list = bySide.get(c.side);
        if (list) list.push(c); else bySide.set(c.side, [c]);
      }
      const hints: EdgeHint[] = [];
      for (const [side, list] of bySide) list.forEach((c, i) => {
        const at = c.at ?? borderPoint(geom, side, (i - (list.length - 1) / 2) * LANE_STEP);
        const key = `${side}:${c.edgeId ?? c.nodeId}`;
        hints.push({ key, label: c.label, x: at[0], y: at[1], side });
        const card = cardOf(c.nodeId);
        if (card) cards.set(key, card);
      });
      return { hints, byLabel: new Map(labels.map(c => [c.label, c.nodeId])), cards };
    };

    // - the part of the pane the cards stay inside: the side the floating chat covers is cut off
    const shownArea = (): Rect => (wrapperRef.current
      ? paneArea(wrapperRef.current)
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
```

3d. `armG` / `disarmG`: set the new state. Keep the comment above `armG` for now. Replace:

```tsx
    const armG = () => {
      const { hints, byLabel } = connectionBadges();
      lastGPressRef.current = Date.now();
      gWindowRef.current = hints.length > 0 ? G_HINT_MS : G_CHORD_MS;
      gLabelsRef.current = byLabel;
      if (gHintTimerRef.current) clearTimeout(gHintTimerRef.current);
      gHintTimerRef.current = null;
      setGHints(h => (hints.length === 0 && h.length === 0 ? h : hints));
      if (hints.length > 0) gHintTimerRef.current = setTimeout(() => { lastGPressRef.current = 0; setGHints([]); }, G_HINT_MS);
    };

    const disarmG = () => {
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      setGHints(h => (h.length === 0 ? h : []));
    };
```

with:

```tsx
    const armG = () => {
      const { hints, byLabel, cards } = connectionBadges();
      lastGPressRef.current = Date.now();
      gWindowRef.current = hints.length > 0 ? G_HINT_MS : G_CHORD_MS;
      gLabelsRef.current = byLabel;
      if (gHintTimerRef.current) clearTimeout(gHintTimerRef.current);
      gHintTimerRef.current = null;
      setGShown(hints.length === 0 ? null : { hints, cards, area: shownArea() });
      if (hints.length > 0) gHintTimerRef.current = setTimeout(() => { lastGPressRef.current = 0; setGShown(null); }, G_HINT_MS);
    };

    const disarmG = () => {
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      setGShown(null);
    };
```

3e. Effect cleanup. Replace:

```tsx
      gLabelsRef.current = EMPTY_LABELS;
      setGHints([]);
    };
```

with:

```tsx
      gLabelsRef.current = EMPTY_LABELS;
      setGShown(null);
    };
```

3f. Render. Replace:

```tsx
        <EdgeFollowHints hints={gHints} />
```

with:

```tsx
        <EdgeFollowHints shown={gShown} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`

Expected: no output.

- [ ] **Step 5: Tests and build**

Run:

```bash
for t in cardContent:card-content hintPlacement:hint-placement spatialNav:spatial-nav; do m=${t%%:*}; f=${t##*:}; npx esbuild src/webview/canvas/$m.ts --bundle --format=esm --outfile=tests/.build/$m.mjs && node --test tests/$f.mjs 2>&1 | grep -E "^# (pass|fail)"; done
npm run build
```

Expected: `# pass 13 / # fail 0`, `# pass 5 / # fail 0`, `# pass 44 / # fail 0`; the build prints no `✘ [ERROR]`.

- [ ] **Step 6: Look once**

Ctrl+F5 opens the Extension Development Host on `test/`. Open `test/H3.canvas`, focus a node with connections, press `g`. Expected: a card next to each badge, then all gone after 1.5 s. Close the host.

- [ ] **Step 7: Commit**

```bash
git add src/webview/hooks/useFileContent.ts src/webview/canvas/EdgeFollowHints.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat: g draws a preview card next to each badge"
```

---

### Task 5: The chord: no timer while badges are shown

**Files:**
- Create: `src/webview/canvas/gChord.ts`
- Modify: `src/webview/canvas/CanvasView.tsx` (6 replacements)
- Modify: `src/webview/canvas/nodes/CodeNode.tsx` (import near line 22; key listener near line 293)
- Test: `tests/g-chord.mjs`

What changes:
- With badges shown, the next key is read by a `keydown` listener at capture on `window` (`gCapture`), registered before `panCapture`. It calls `stopImmediatePropagation`, so `panCapture`, a node's React `onKeyDown` (the `TextNode` Enter), the bubble handler and VS Code's key forwarder never see the key.
- `CodeNode` has its own capture listener on `window` (Enter, `o`, run keys). It may have been added before `gCapture`, so it runs first. It now returns early while `<html>` carries `data-skena-g-badges`. Without that, `o` or Enter on a focused code cell would also add a cell below or open the editor. (Its `stopPropagation` does not stop `gCapture`: both listen on `window`.)
- A `pointerdown` at capture on `window` closes the badges. The click then does what it always does.
- A node with no connections shows nothing and keeps the 400 ms window. The key after it is read in the bubble handler, as before.
- The canvas-switch close moves out of the big key effect into its own effect on `canvasPath`. The big effect re-runs whenever one of its 22 dependencies changes; closing there would close the badges on any such re-run, not only on a canvas switch.

- [ ] **Step 1: Write the failing test**

Create `tests/g-chord.mjs`:

```js
// - run: npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { G_CHORD_MS, gChordStep } from './.build/gChord.mjs';

// - g pressed at t = 1000 on a node with two connections, and on one with none
const shown = { armedAt: 1000, showing: true, labels: new Map([['l', 'N8'], ['1', 'E4']]) };
const plain = { armedAt: 1000, showing: false, labels: new Map() };
const key = (k, mods = {}) => ({ key: k, shift: false, ctrl: false, meta: false, alt: false, ...mods });

test('1. with badges shown, a badge key still jumps long after the old 1.5 s', () => {
  assert.deepEqual(gChordStep(shown, key('1'), 1000 + 60_000), { do: 'jump', nodeId: 'E4' });
  assert.deepEqual(gChordStep(shown, key('l'), 1000 + 2_000), { do: 'jump', nodeId: 'N8' });
});

test('2. with badges shown, Esc and any other key close them and do nothing else', () => {
  assert.deepEqual(gChordStep(shown, key('Escape'), 1200), { do: 'close' });
  assert.deepEqual(gChordStep(shown, key('x'), 1200), { do: 'close' });
  assert.deepEqual(gChordStep(shown, key('l', { ctrl: true }), 1200), { do: 'close' });
});

test('3. a second g goes to the first member of the section, with or without badges', () => {
  assert.deepEqual(gChordStep(shown, key('g'), 5000), { do: 'first' });
  assert.deepEqual(gChordStep(plain, key('g'), 1000 + G_CHORD_MS - 1), { do: 'first' });
});

test('4. a node without connections keeps the 400 ms window, and another key passes through', () => {
  assert.deepEqual(gChordStep(plain, key('h'), 1100), { do: 'pass' });
  assert.equal(gChordStep(plain, key('g'), 1000 + 400), null);
});

test('5. a disarmed chord reads no key', () => {
  assert.equal(gChordStep({ ...shown, armedAt: 0 }, key('l'), 1200), null);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/webview/canvas/gChord.ts"`.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/gChord.ts`:

```ts
// - how long g waits for its second key when it shows nothing
export const G_CHORD_MS = 400;
// - set on <html> while the badges are on screen, so a node's own key listener leaves the key to them
export const G_BADGES_ATTR = 'data-skena-g-badges';

export interface GChordState {
  /** - when g was pressed; 0 while the chord is not armed */
  armedAt: number;
  /** - true while the badges are on screen */
  showing: boolean;
  /** - each badge key → the node its connection leads to */
  labels: ReadonlyMap<string, string>;
}

export interface KeyPress { key: string; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean }

/**
 * - `first`: a second g, to the first member of the section
 * - `jump`: a badge key, to the node its connection leads to
 * - `close`: any other key while the badges are shown; it closes them and does nothing else
 * - `pass`: any other key of a chord that shows nothing; it cancels the chord and is handled as usual
 */
export type GChordStep = { do: 'first' } | { do: 'jump'; nodeId: string } | { do: 'close' } | { do: 'pass' };

/**
 * What the key after `g` does. The badges have no time limit: they wait for the next key. A chord
 * that shows nothing, on a node without connections, lasts G_CHORD_MS. Null when the chord is not
 * armed or that window has run out, so the key is not the chord's.
 */
export function gChordStep(s: GChordState, k: KeyPress, now: number): GChordStep | null {
  if (s.armedAt === 0) return null;
  if (!s.showing && now - s.armedAt >= G_CHORD_MS) return null;
  if (!k.shift && !k.ctrl && !k.meta && !k.alt) {
    if (k.key === 'g') return { do: 'first' };
    const nodeId = k.key.length === 1 ? s.labels.get(k.key) : undefined;
    if (nodeId !== undefined) return { do: 'jump', nodeId };
  }
  return s.showing ? { do: 'close' } : { do: 'pass' };
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs`

Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Wire it into `CanvasView.tsx`**

Make these six replacements in `src/webview/canvas/CanvasView.tsx` (the file as Task 4 left it). Each old block occurs once.

5a. Import. Replace:

```tsx
import { loadedFileText } from '../hooks/useFileContent';
```

with:

```tsx
import { loadedFileText } from '../hooks/useFileContent';
import { G_BADGES_ATTR, gChordStep } from './gChord';
```

5b. Delete the two constants near line 174. `G_CHORD_MS` now lives in `gChord.ts`; `G_HINT_MS` goes. Delete these four lines:

```tsx
// - how long g waits for its second key
const G_CHORD_MS = 400;
// - the chord window once the labels are on screen: long enough to find one and type it
const G_HINT_MS = 1500;
```

5c. Refs and state near line 537: drop `gWindowRef` and `gHintTimerRef`; add `gShowingRef`, `closeG`, the click listener and the canvas-switch close. Replace:

```tsx
  // - g chord: the moment g was pressed; the next key counts as its second within gWindowRef
  const lastGPressRef  = useRef<number>(0);
  // - G_CHORD_MS, or G_HINT_MS while the labels are on screen
  const gWindowRef     = useRef<number>(G_CHORD_MS);
  // - what each label key follows: the node at the other end of that connection
  const gLabelsRef     = useRef<ReadonlyMap<string, string>>(EMPTY_LABELS);
  const gHintTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // - the badges drawn over the focused node's borders and the card of the node each one leads to;
  //   only while the chord is armed
  const [gShown, setGShown] = useState<ShownHints | null>(null);
```

with:

```tsx
  // - g chord: the moment g was pressed, 0 when disarmed. Badges on screen wait for the next key or
  //   click; a g that shows nothing lasts G_CHORD_MS (see gChordStep)
  const lastGPressRef  = useRef<number>(0);
  // - what each label key follows: the node at the other end of that connection
  const gLabelsRef     = useRef<ReadonlyMap<string, string>>(EMPTY_LABELS);
  // - the badges drawn over the focused node's borders and the card of the node each one leads to;
  //   only while the chord is armed
  const [gShown, setGShown] = useState<ShownHints | null>(null);
  // - gShown !== null, for the key listeners, which read refs
  const gShowingRef    = useRef(false);
  // - drop the armed chord and everything it put on screen
  const closeG = useCallback(() => {
    lastGPressRef.current = 0;
    gLabelsRef.current = EMPTY_LABELS;
    gShowingRef.current = false;
    document.documentElement.removeAttribute(G_BADGES_ATTR);
    setGShown(null);
  }, []);
  // - a click anywhere closes the badges; the click itself goes on as usual
  useEffect(() => {
    if (gShown === null) return;
    window.addEventListener('pointerdown', closeG, { capture: true });
    return () => window.removeEventListener('pointerdown', closeG, { capture: true });
  }, [gShown, closeG]);
  // - a canvas switch drops the armed chord and its badges
  useEffect(() => closeG, [canvasPath, closeG]);
```

5d. `armG` / `disarmG` become `armG` / `readGKey`. `readGKey` calls `jumpInSection`, which is declared a few lines below it; that is fine, because it only runs on a later key press. Replace:

```tsx
    // - arm the g chord and show the labels. Reading one and typing it takes longer than the second
    //   key of a plain chord, so the window only stretches to G_HINT_MS when there is something to
    //   read; a node with no connection keeps the old 400 ms.
    const armG = () => {
      const { hints, byLabel, cards } = connectionBadges();
      lastGPressRef.current = Date.now();
      gWindowRef.current = hints.length > 0 ? G_HINT_MS : G_CHORD_MS;
      gLabelsRef.current = byLabel;
      if (gHintTimerRef.current) clearTimeout(gHintTimerRef.current);
      gHintTimerRef.current = null;
      setGShown(hints.length === 0 ? null : { hints, cards, area: shownArea() });
      if (hints.length > 0) gHintTimerRef.current = setTimeout(() => { lastGPressRef.current = 0; setGShown(null); }, G_HINT_MS);
    };

    const disarmG = () => {
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      setGShown(null);
    };
```

with:

```tsx
    // - arm the g chord and show the badges with their cards. They stay until the next key or click;
    //   a node with no connection shows nothing and keeps the plain G_CHORD_MS window.
    const armG = () => {
      const { hints, byLabel, cards } = connectionBadges();
      lastGPressRef.current = Date.now();
      gLabelsRef.current = byLabel;
      gShowingRef.current = hints.length > 0;
      if (hints.length > 0) document.documentElement.setAttribute(G_BADGES_ATTR, '1');
      else document.documentElement.removeAttribute(G_BADGES_ATTR);
      setGShown(hints.length === 0 ? null : { hints, cards, area: shownArea() });
    };

    // - the key after g, as gChordStep reads it. True when the chord used the key; false when the
    //   key is not the chord's, or cancelled a chord that showed nothing and is handled as usual.
    const readGKey = (e: KeyboardEvent): boolean => {
      const step = gChordStep(
        { armedAt: lastGPressRef.current, showing: gShowingRef.current, labels: gLabelsRef.current },
        { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey },
        Date.now(),
      );
      if (step === null) return false;
      closeG();
      if (step.do === 'pass') return false;
      e.preventDefault();
      if (step.do === 'first') jumpInSection('first');
      else if (step.do === 'jump') focusNodeById(step.nodeId);
      return true;
    };
```

5e. The chord block in `handler`, after the Alt+X chord. Replace:

```tsx
      // ── g chord: consume the second key (a connection label follows it, g jumps to the section top) ──
      if (lastGPressRef.current !== 0 && Date.now() - lastGPressRef.current < gWindowRef.current) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key === 'g') { disarmG(); e.preventDefault(); jumpInSection('first'); return; }
          // - h/k/l/j are labels too, so while the chord is armed they follow the first connection of
          //   their border rather than navigating; a border with none leaves the key unclaimed
          const target = e.key.length === 1 ? gLabelsRef.current.get(e.key) : undefined;
          if (target !== undefined) { disarmG(); e.preventDefault(); focusNodeById(target); return; }
        }
        // - any other key cancels the chord and is then handled normally, so plain h still
        //   navigates left; falling through is the whole point
        disarmG();
      }
```

with:

```tsx
      // - the key after a g that showed nothing (gCapture takes it while badges are shown): a second
      //   g goes to the section top, any other key cancels the chord and is then handled normally,
      //   so plain h still navigates left
      if (readGKey(e)) return;
```

5f. Listeners and cleanup at the end of the key effect; `closeG` joins the dependency list. Replace:

```tsx
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', panCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', panCapture, { capture: true });
      // - a canvas switch re-runs this effect: drop the armed chord and its badges with it
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      setGShown(null);
    };
  }, [setNodes, setEdges, focusNodeById, pickViewportNode, addTextNodeInDirection, undo, redo, scheduleSave, setSearchOpen, setMarksOpen, closeKnowledge, pushHistory, handleCopy, pasteInternalClipboard, deleteSelectedNodes, performDelete, jumpToRegister, engineNodesOf, runEngineAfterMove, anchoredBy, runEngineForCells, canvasPath]); // - nodesRef + spaceSelectedRef carry live state
```

with:

```tsx
    // - while the badges are shown the next key is theirs, wherever the focus sits: read here at
    //   capture and stopped, so no node, no other binding and not VS Code acts on it
    const gCapture = (e: KeyboardEvent) => {
      if (!gShowingRef.current) return;
      readGKey(e);
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // - gCapture before panCapture: listeners on one target run in the order they were added
    window.addEventListener('keydown', gCapture, { capture: true });
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', panCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', gCapture, { capture: true });
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', panCapture, { capture: true });
    };
  }, [setNodes, setEdges, focusNodeById, pickViewportNode, addTextNodeInDirection, undo, redo, scheduleSave, setSearchOpen, setMarksOpen, closeKnowledge, pushHistory, handleCopy, pasteInternalClipboard, deleteSelectedNodes, performDelete, jumpToRegister, engineNodesOf, runEngineAfterMove, anchoredBy, runEngineForCells, canvasPath, closeG]); // - nodesRef + spaceSelectedRef carry live state
```

- [ ] **Step 6: `CodeNode` leaves the key to the badges**

In `src/webview/canvas/nodes/CodeNode.tsx`, replace:

```tsx
import { CodeRenderer } from '../../renderers/CodeRenderer';
```

with:

```tsx
import { CodeRenderer } from '../../renderers/CodeRenderer';
import { G_BADGES_ATTR } from '../gChord';
```

Then replace:

```tsx
      if (inField(e.target as HTMLElement | null) || inField(document.activeElement as HTMLElement | null)) return;
```

with:

```tsx
      if (inField(e.target as HTMLElement | null) || inField(document.activeElement as HTMLElement | null)) return;
      // - while the g badges are shown the next key is theirs; this listener may run before theirs
      if (document.documentElement.hasAttribute(G_BADGES_ATTR)) return;
```

- [ ] **Step 7: Typecheck and look for leftovers**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"
grep -n "G_HINT_MS\|gWindowRef\|gHintTimerRef\|disarmG\|setGHints" src/webview/canvas/CanvasView.tsx
```

Expected: no output from either command.

- [ ] **Step 8: All tests and build**

Run:

```bash
for t in cardContent:card-content hintPlacement:hint-placement gChord:g-chord spatialNav:spatial-nav; do m=${t%%:*}; f=${t##*:}; npx esbuild src/webview/canvas/$m.ts --bundle --format=esm --outfile=tests/.build/$m.mjs && node --test tests/$f.mjs 2>&1 | grep -E "^# (pass|fail)"; done
npm run build
```

Expected: 13, 5, 5 and 44 passing, 0 failing; the build prints no `✘ [ERROR]`.

- [ ] **Step 9: Commit**

```bash
git add src/webview/canvas/gChord.ts src/webview/canvas/CanvasView.tsx src/webview/canvas/nodes/CodeNode.tsx tests/g-chord.mjs
git commit -m "feat: g badges and cards stay until the next key or click; Esc, another key or a click closes them"
```

---

### Task 6: Manual check in the Extension Development Host

**Files:** none. The user runs this.

Press Ctrl+F5 in VS Code. It builds and opens the Extension Development Host on `test/`. Open `test/H3.canvas`. In the mock, E7 had one connection on the right (N8) and three at the bottom (E2, E1, E4); if the canvas has changed, pick any node with connections on two or more borders.

**Cards**
- [ ] `g` on a node with connections: one badge per connection, as before, and a card next to each badge on the side away from the node.
- [ ] Card header: label and type, e.g. `E7 · code · python`; an output cell reads `C1 · output of E1`.
- [ ] Card border: the node's border colour. A code cell with no colour set: light green (`#3fb27f`), not the dark `#02542e`.
- [ ] Code cell card: its first 3 non-empty lines, monospace, in the same colours as the code preview. No editor cursor, line numbers or vim status bar in the card.
- [ ] Note with a heading: the heading in bold, then the next lines as plain text. A LaTeX formula (`$…$`, `$$…$$`) and a typst formula (`%…%`) are drawn as math.
- [ ] Note without a heading: its first 3 lines.
- [ ] File node: the path; after the file preview has loaded, also the file's first heading in bold.
- [ ] Output cell, html (a printed value or a table): its first lines as text, no tags.
- [ ] Output cell, image: a thumbnail fitted in the card body.
- [ ] Output cell, plotly: the word `plot`.
- [ ] Knowledge node: the title, then the source path.
- [ ] Link or portal: the URL, or the label and the `.canvas` path.

**Placement**
- [ ] Three connections on one border: the cards do not overlap, keep the badge order, and are centred on the badges. A card moved off its badge has a thin line back to it.
- [ ] Pan so the focused node touches the right edge of the view, press `g`: the right-border cards are pushed inside the view.
- [ ] Open the floating chat on one side, press `g`: no card goes under the chat.
- [ ] Zoom out, then in, with the badges shown: the cards stay 228 px wide.
- [ ] Wheel-pan with the badges shown: badges and cards move with the canvas.

**Chord**
- [ ] `g`, wait 5 s: badges and cards are still there.
- [ ] `g`, then a badge key: focus jumps to that node; badges and cards close.
- [ ] `g`, then `Esc`: they close; the focus does not move.
- [ ] `g`, then `x`: they close; nothing else happens.
- [ ] Focus a note, `g`, then `Enter`: they close; the note does not enter edit mode.
- [ ] Focus a code cell with connections, `g`, then `o`: they close; no new cell is added below. `g`, then `Enter`: they close; the editor does not open.
- [ ] `g`, then Shift+Alt+L: they close; the view does not pan.
- [ ] `g`, then click empty canvas: they close. `g`, then click a node: they close and that node is selected.
- [ ] `gg`: the first node of the section, as before.
- [ ] A node with no connections: `g` shows nothing; `g` then `h` within 400 ms moves left; `gg` goes to the section's first node.
- [ ] Switch to another canvas tab with the badges shown, come back: no badges are left over.

If a check fails, write down the node label, the key pressed, and what was seen.

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Badges as today, one per connection, all four borders | unchanged `connectionLabels`; `placeBadges` keeps `place()`'s maths (Task 2, test 1) |
| A card next to each badge for the node it leads to | Task 4 (`cardOf`, `EdgeFollowHints`) |
| No timer; badge key jumps; Esc, other key, click close; 400 ms without connections | Task 5 (`gChordStep` tests 1-5, `gCapture`, `pointerdown` listener) |
| Card 228 px wide, body at most 3 lines (58 px), does not scale with zoom | `CARD_W`, `CARD_BODY_H` in `hintPlacement.ts`; the overlay is outside the React Flow viewport transform |
| Header: label and type; border = `nodeBorderColor`; lighter code border | `cardContent` (tests 1-2), `CARD_CODE_BORDER` |
| Table: code, text, file, html, markdown, image, plotly, knowledge, other | `cardContent` tests 1-13, one or more per row |
| Nothing fetched to build a card | node data from `nodesRef`; file text only from the preview cache (`loadedFileText`) |
| Card outside its badge, away from the node; fan with the card size; line back when moved; inside the pane | `placeCards` (tests 2-5) |
| Tests: content (pure), placement (pure), chord | `tests/card-content.mjs`, `tests/hint-placement.mjs`, `tests/g-chord.mjs` |

Choices the spec does not settle. Each is in the code as described; the user may want another:
1. **A modifier pressed alone** (Shift, Ctrl) counts as "any other key" and closes the badges.
2. **A click** closes the badges and then does what it always does. Clicking a node selects it. The spec says "closes them without moving"; this plan reads that as "does not jump".
3. **Typst in a card** goes through the host's render request, the same one a note uses. That renders text the webview holds; it fetches no content. The first card with `%` can show unrendered text for one round trip.
4. **Cards of two different borders** can overlap near a corner. The spec asks for no overlap within one border only.
5. **Card height** is fixed at 81 px even when the body is shorter ("fixed screen size").
6. **Code border** on a card is the mock's `#3fb27f`, a palette constant. `lighten()` would give `#06e980`.
7. **Fenced code inside a note** is left out of the note's card. A notebook `file` node shows only its path.
8. **Badges stay** if the focus moves by another route (an MCP `focusNode`) or the webview loses focus, until the next key or click in the canvas.
