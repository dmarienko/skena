// - run: npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  codeCellsInRunOrder, dottedNameAt, fileUri, fromJoined, isDottedName, joinCells, pickEntry, targetsFromKernel,
  targetsFromLocations, toJoined,
} from './.build/goToDefinition.mjs';

// - the 1-based column of the n-th (0-based) occurrence of `part` in `line`
const colOf = (line, part, n = 0) => {
  let i = -1;
  for (let k = 0; k <= n; k++) i = line.indexOf(part, i + 1);
  return i + 1;
};

test('1. dotted names: names and dots only', () => {
  for (const ok of ['x', 'np.linalg.solve', '_a1.b_2', 'été.ça']) assert.ok(isDottedName(ok), ok);
  for (const bad of ['', '1x', 'a.', '.a', 'a..b', 'f()', 'a[0]', 'a b', 'a.1']) assert.ok(!isDottedName(bad), bad);
});

test('2. the cursor on solve asks for np.linalg.solve, on linalg for np.linalg, on np for np', () => {
  const line = 'x = np.linalg.solve(a, b)';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'solve') + 2), { word: 'solve', dotted: 'np.linalg.solve', start: colOf(line, 'solve'), end: colOf(line, 'solve') + 5 });
  assert.equal(dottedNameAt(line, colOf(line, 'linalg')).dotted, 'np.linalg');
  assert.equal(dottedNameAt(line, colOf(line, 'np')).dotted, 'np');
  assert.equal(dottedNameAt(line, colOf(line, '(a') + 1).dotted, 'a');
});

test('3. a chain through a call or subscript has no dotted name; the word is still there', () => {
  const line = 'df.groupby(k).mean().x[0].y';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'mean')), { word: 'mean', dotted: null, start: colOf(line, 'mean'), end: colOf(line, 'mean') + 4 });
  assert.equal(dottedNameAt(line, line.length).dotted, null);   // - the final y
  assert.equal(dottedNameAt(line, colOf(line, 'groupby')).dotted, 'df.groupby');
});

test('4. no name under the cursor: a blank, an operator, a dot, a number, past the end', () => {
  const line = 'y = f(1.5) + self.fit';
  for (const col of [2, 3, colOf(line, '('), colOf(line, '1'), colOf(line, '5'), colOf(line, '.', 1), line.length + 1, 0]) {
    assert.equal(dottedNameAt(line, col), null, `col ${col}`);
  }
  assert.equal(dottedNameAt(line, colOf(line, 'fit')).dotted, 'self.fit');
});

test('5. letters outside ASCII are name characters', () => {
  const line = 'v = été.ça';
  assert.equal(dottedNameAt(line, colOf(line, 'ça')).dotted, 'été.ça');
});

// - S1 (y 0) holds B (500,0) and A (0,100); S2 (y 1000, listed first) holds D (600,1200) and C (0,1200).
//   T is a text note. Without sections every code cell goes by y, then x.
const NODES = [
  { id: 'A', type: 'code', x: 0, y: 100, width: 400, height: 200 },
  { id: 'B', type: 'code', x: 500, y: 0, width: 400, height: 200 },
  { id: 'T', type: 'text', x: 0, y: 0, width: 400, height: 50 },
  { id: 'D', type: 'code', x: 600, y: 1200, width: 400, height: 200 },
  { id: 'C', type: 'code', x: 0, y: 1200, width: 400, height: 200 },
];
const LANES = [{ id: 's2', y: 1000, createdAt: 2 }, { id: 's1', y: 0, createdAt: 1 }];

test('6. run order: section by section from the top, in each top to bottom then left to right; code cells only', () => {
  assert.deepEqual(codeCellsInRunOrder(NODES, LANES), ['B', 'A', 'C', 'D']);
  assert.deepEqual(codeCellsInRunOrder(NODES, []), ['B', 'A', 'C', 'D']);
});

const CELLS = [
  { id: 'A', code: 'import numpy as np\r\nx = 1' },
  { id: 'E', code: '' },
  { id: 'B', code: '%matplotlib inline\n  !ls -la\ndef f():\n    return x\n' },
  { id: 'C', code: '%%bash\necho (\n' },
  { id: 'D', code: '%%time\ny = f()' },
];

test('7. joined: header, each cell then an empty line; CRLF split; magic lines and non-Python cell magics commented', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.equal(j.text, [
    '# type: ignore',
    'import numpy as np', 'x = 1', '',
    '', '',
    '#matplotlib inline', '  #ls -la', 'def f():', '    return x', '', '',
    '#%bash', '#cho (', '', '',
    '#%time', 'y = f()', '',
  ].join('\n'));
  assert.deepEqual(j.spans, [
    { id: 'A', first: 1, lines: 2 }, { id: 'E', first: 4, lines: 1 }, { id: 'B', first: 6, lines: 5 },
    { id: 'C', first: 12, lines: 3 }, { id: 'D', first: 16, lines: 2 },
  ]);
});

test('8. positions both ways: cell line/col (1-based) <-> joined line/character (0-based)', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.deepEqual(toJoined(j, 'A', 2, 1), { line: 2, character: 0 });
  assert.deepEqual(toJoined(j, 'B', 4, 12), { line: 9, character: 11 });
  assert.deepEqual(toJoined(j, 'E', 1, 1), { line: 4, character: 0 });
  assert.deepEqual(fromJoined(j, { line: 9, character: 11 }), { cellId: 'B', line: 4, col: 12 });
  assert.deepEqual(fromJoined(j, { line: 4, character: 0 }), { cellId: 'E', line: 1, col: 1 });
  for (let line = 0; line < 19; line++) {
    const c = fromJoined(j, { line, character: 3 });
    if (c) assert.deepEqual(toJoined(j, c.cellId, c.line, c.col), { line, character: 3 }, `line ${line}`);
  }
  assert.equal(fromJoined(j, { line: 0, character: 0 }), null);   // - the header
  assert.equal(fromJoined(j, { line: 3, character: 0 }), null);   // - between A and E
  assert.equal(toJoined(j, 'A', 3, 1), null);
  assert.equal(toJoined(j, 'Z', 1, 1), null);
});

const J = joinCells([{ id: 'A', code: 'x = 1\ny = 2' }, { id: 'B', code: 'x = 3\nprint(x)' }, { id: 'C', code: 'x = 4' }]);
const DOC = 'file:///run/user/1000/skena/def.py';
const loc = (line, character, uri = DOC) => ({ uri, line, character });

test('9. Pylance: a definition in the joined document goes to its cell; of several the last one before the cursor', () => {
  const cursor = { line: 4, character: 6 };   // - the x of print(x) in B
  assert.deepEqual(targetsFromLocations([loc(0, 0), loc(3, 0), loc(6, 0)], DOC, J, cursor), [{ kind: 'cell', cellId: 'B', line: 1, col: 1 }]);
  assert.deepEqual(targetsFromLocations([loc(6, 0)], DOC, J, { line: 0, character: 0 }), [{ kind: 'cell', cellId: 'C', line: 1, col: 1 }]);
});

test('10. Pylance: a definition in a file goes to the file; none before the cursor keeps all; repeats and gaps dropped', () => {
  const lib = 'file:///venv/lib/numpy/linalg/_linalg.py';
  assert.deepEqual(targetsFromLocations([loc(363, 4, lib), loc(363, 4, lib)], DOC, J, { line: 0, character: 0 }), [{ kind: 'file', uri: lib, line: 364, col: 5 }]);
  assert.deepEqual(targetsFromLocations([loc(3, 0), loc(6, 0)], DOC, J, { line: 0, character: 0 }), [
    { kind: 'cell', cellId: 'B', line: 1, col: 1 }, { kind: 'cell', cellId: 'C', line: 1, col: 1 },
  ]);
  assert.deepEqual(targetsFromLocations([loc(2, 0)], DOC, J, { line: 4, character: 0 }), []);
});

// - what the kernel sent for after_magic in a real ipykernel 6.31 (IPython 9.12): the cell as compiled,
//   its %time line already turned into a call
const KCELL = "get_ipython().run_line_magic('time', 'x = 1')\ndef after_magic():\n    return 2\n";
const kdef = (over = {}) => ({ file: '/tmp/ipykernel_1/2.py', line: 2, col: 5, exists: false, cell: KCELL, start: 2, count: 2, ...over });

test('11. kernel: the cell whose text is the kernel copy (CRLF, trailing blanks ignored), at the kernel line', () => {
  const cells = [{ id: 'A', code: 'z = 0' }, { id: 'B', code: "get_ipython().run_line_magic('time', 'x = 1')\r\ndef after_magic():   \r\n    return 2\r\n\r\n" }];
  assert.deepEqual(targetsFromKernel(kdef(), cells), [{ kind: 'cell', cellId: 'B', line: 2, col: 5 }]);
});

test('12. kernel: else every cell holding the block, at its def line; a decorated def counts from the decorator', () => {
  const cells = [
    { id: 'A', code: '%time x = 1\ndef after_magic():\n    return 2' },
    { id: 'B', code: '# copy\n\n\ndef after_magic():\n    return 2' },
  ];
  assert.deepEqual(targetsFromKernel(kdef(), cells), [{ kind: 'cell', cellId: 'A', line: 2, col: 5 }, { kind: 'cell', cellId: 'B', line: 4, col: 5 }]);
  const deco = { file: '/tmp/ipykernel_1/3.py', line: 3, col: 5, exists: false, cell: 'import f\n@f.wrap\ndef g():\n    pass\n', start: 2, count: 3 };
  assert.deepEqual(targetsFromKernel(deco, [{ id: 'C', code: 'x = 1\n@f.wrap\ndef g():\n    pass' }]), [{ kind: 'cell', cellId: 'C', line: 3, col: 5 }]);
});

test('13. kernel: a cell file found nowhere gives nothing; a file on disk is the file', () => {
  assert.deepEqual(targetsFromKernel(kdef(), [{ id: 'A', code: 'def after_magic():\n    return 3' }]), []);
  const file = { file: '/home/u/p/src/m.py', line: 5, col: 5, exists: true };
  assert.deepEqual(targetsFromKernel(file, []), [{ kind: 'file', uri: 'file:///home/u/p/src/m.py', line: 5, col: 5 }]);
});

test('14. file URIs from kernel paths: segments encoded, Windows drives kept', () => {
  assert.equal(fileUri('/home/u/my dir/a#b.py'), 'file:///home/u/my%20dir/a%23b.py');
  assert.equal(fileUri('C:\\Users\\u\\a.py'), 'file:///C:/Users/u/a.py');
});

test('15. quick pick: E7:12 for a cell; a file relative to its workspace folder, else ~, else in full', () => {
  const labelOf = id => ({ A: 'E7' })[id] ?? id;
  const pathOf = uri => decodeURIComponent(uri.replace(/^file:\/\//, ''));
  const roots = ['/home/u/proj'];
  const at = (t, text = '    def solve(a, b):') => pickEntry(t, text, labelOf, pathOf, roots, '/home/u');
  assert.deepEqual(at({ kind: 'cell', cellId: 'A', line: 12, col: 5 }, 'def f():'), { label: 'E7:12', description: 'def f():' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/proj/src/m.py', line: 3, col: 1 }), { label: 'src/m.py:3', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/.venv/lib/np.py', line: 364, col: 5 }), { label: '~/.venv/lib/np.py:364', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///usr/lib/x.py', line: 1, col: 1 }), { label: '/usr/lib/x.py:1', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/projx/a.py', line: 1, col: 1 }), { label: '~/projx/a.py:1', description: 'def solve(a, b):' });
});

test('16. a definition on the cursor\'s own line counts only when none comes before that line', () => {
  const j = joinCells([{ id: 'A', code: 'df = 1\ndf = df + 1' }]);
  // - the right-hand df of line 2: Pylance gives both assignments
  assert.deepEqual(targetsFromLocations([loc(0, 0), loc(1, 0)], DOC, j, { line: 1, character: 5 }), [{ kind: 'cell', cellId: 'A', line: 1, col: 1 }]);
  const lone = joinCells([{ id: 'A', code: 'x = 0' }, { id: 'B', code: 'df = df.copy()' }]);
  assert.deepEqual(targetsFromLocations([loc(2, 0)], DOC, lone, { line: 2, character: 5 }), [{ kind: 'cell', cellId: 'B', line: 1, col: 1 }]);
  // - an earlier cell's definition beats the cursor's line
  const two = joinCells([{ id: 'A', code: 'df = 1' }, { id: 'B', code: 'df = df.copy()' }]);
  assert.deepEqual(targetsFromLocations([loc(0, 0), loc(2, 0)], DOC, two, { line: 2, character: 5 }), [{ kind: 'cell', cellId: 'A', line: 1, col: 1 }]);
});

// - the line the join puts after a cell: the closers of what the cell leaves open
const closersOf = code => {
  const j = joinCells([{ id: 'A', code }]);
  return j.text.split('\n')[j.spans[0].lines];
};

test('17. after a cell, the line between cells closes the brackets and the string it leaves open', () => {
  const cases = [
    ['x = (', ')'],
    ['foo(1, [2, {3: (4', ')}])'],
    ['foo(\n  a,\n  b', ')'],
    ['s = """abc', '"""'],
    ["s = '''abc\n  more", "'''"],
    ['x = ("""a\nb', '""")'],
    ["x = ('abc\\", "')"],
    ["s = 'abc\\", "'"],
    ['"""a"""(', ')'],
    ['x = 1)', ''],
    ['x = 1', ''],
    ['', ''],
  ];
  for (const [code, want] of cases) assert.equal(closersOf(code), want, JSON.stringify(code));
});

test('18. an unterminated one-line string ends at its line; brackets in strings and comments do not count; prefixes and escapes', () => {
  const cases = [
    ["'abc", ''],
    ["foo('abc", ')'],
    ['x = "(["', ''],
    ["x = ')' + \"]\" + '{'", ''],
    ['x = 1  # (see [this', ''],
    ['foo(1,  # )\n  2', ')'],
    ["z = (rb'\\\\', Rb\"(\", br'''x(''', U'[', F\"{y}\"", ')'],
    ["u = f'''{x}(", "'''"],
    ['s = "a\\"("', ''],
    ["s = ('a\\'b'", ')'],
    ['s = r"\\""', ''],
    ["s = '''a ''' + '''b\n''' + [", ']'],
    ['t = """ " \'\'\' "" """ + (', ')'],
  ];
  for (const [code, want] of cases) assert.equal(closersOf(code), want, JSON.stringify(code));
});

test('19. a line is a magic only at the start of a statement: not inside brackets, a string, or after a backslash', () => {
  const lines = code => joinCells([{ id: 'A', code }]).text.split('\n');
  assert.deepEqual(lines('x = (a\n% b)'), ['x = (a', '% b)', '']);
  assert.deepEqual(lines('y = [1,\n  %time\n]'), ['y = [1,', '  %time', ']', '']);
  assert.deepEqual(lines('z = 1 + \\\n%d'), ['z = 1 + \\', '%d', '']);
  assert.deepEqual(lines('s = """\n%time\n!ls\n"""'), ['s = """', '%time', '!ls', '"""', '']);
  assert.deepEqual(lines('x = (1,\n  2)\n%time f()\n!ls'), ['x = (1,', '  2)', '#time f()', '#ls', '']);
});

test('20. Python\'s own tokenizer: after the line between cells the next cell starts a statement at depth 0', () => {
  const cells = [
    'x = (', 'foo(1, [2, {3: (4', 's = """abc', "s = '''abc\n  more", 'x = ("""a\nb', "x = ('abc\\",
    "z = (rb'\\\\', Rb\"(\", br'''x(''', U'[', F\"{y}\"", 'foo(1,  # )\n  2', 'x = (a\n% b', 'def f():\n    return g(',
  ];
  const texts = cells.map(code => joinCells([{ id: 'A', code }, { id: 'B', code: 'later = 1' }]).text);
  const py = `
import io, json, sys, tokenize
out = []
for text in json.load(sys.stdin):
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text + '\\n').readline))
        at = [i for i, t in enumerate(toks) if t.string == 'later']
        prev = toks[at[0] - 1].type if at else None
        out.append('ok' if at and toks[at[0]].start[1] == 0 and prev in (tokenize.NEWLINE, tokenize.NL, tokenize.DEDENT) else 'later not at a statement start')
    except Exception as e:
        out.append(type(e).__name__ + ': ' + str(e))
print(json.dumps(out))
`;
  const run = spawnSync(process.env.PYTHON ?? 'python3', ['-c', py], { input: JSON.stringify(texts), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const got = JSON.parse(run.stdout);
  cells.forEach((c, i) => assert.equal(got[i], 'ok', JSON.stringify(c)));
});

test('21. random cells, unbalanced ones too: every position maps both ways, each cell line keeps its length, the line between cells holds closers only', () => {
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const parts = ['a', 'x', ' ', '  ', '(', ')', '[', ']', '{', '}', '"', "'", '"""', "'''", '#', '%', '%%time', '!', '\\', '\n', '\r\n', '\r', 'f', 'r', 'b', '=', '.'];
  const cellOf = () => Array.from({ length: rand(30) }, () => parts[rand(parts.length)]).join('');
  for (let k = 0; k < 400; k++) {
    const cells = Array.from({ length: 1 + rand(5) }, (_, i) => ({ id: `c${i}`, code: cellOf() }));
    const j = joinCells(cells, ['# h']);
    const doc = j.text.split('\n');
    assert.equal(doc.length, 1 + cells.reduce((n, c) => n + c.code.split(/\r\n|\r|\n/).length + 1, 0));
    for (const [i, c] of cells.entries()) {
      const s = j.spans[i];
      const own = c.code.split(/\r\n|\r|\n/);
      assert.equal(s.lines, own.length);
      assert.match(doc[s.first + s.lines], /^(?:"""|'''|"|')?[)\]}]*$/, JSON.stringify(c.code));
      assert.equal(fromJoined(j, { line: s.first + s.lines, character: 0 }), null);
      for (const [n, text] of own.entries()) {
        assert.equal(doc[s.first + n].length, text.length);
        for (let col = 1; col <= text.length + 1; col++) {
          const p = toJoined(j, c.id, n + 1, col);
          assert.deepEqual(fromJoined(j, p), { cellId: c.id, line: n + 1, col }, JSON.stringify({ code: c.code, n, col }));
        }
      }
    }
  }
});

test('22. a keyword is not a name, alone or as a part; soft keywords are names', () => {
  for (const kw of ['import', 'class', 'None', 'True', 'lambda', 'await', 'np.class', 'x.None.y']) assert.ok(!isDottedName(kw), kw);
  for (const ok of ['match', 'case', 'type', '_', 'np.match', 'Import', 'none']) assert.ok(isDottedName(ok), ok);
  assert.equal(dottedNameAt('import numpy as np', 1), null);
  assert.equal(dottedNameAt('x = None', 5), null);
  assert.equal(dottedNameAt('import numpy as np', 8).dotted, 'numpy');
});
