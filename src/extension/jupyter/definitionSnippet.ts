/**
 * The kernel's half of go to definition: a Python expression, sent as a user_expression of a silent
 * execute_request (protocol.ts buildSilentEvaluateRequest), that says where a dotted name of the
 * kernel's namespace is defined. The name is looked up without eval: its first part in the namespace
 * or the builtins, the rest as attributes, the last one with inspect.getattr_static when it can be (so
 * a property's code does not run and its getter is found). Properties, class and static methods,
 * partials and decorated functions (__wrapped__) are unwrapped; any other value stands for its class.
 * The helpers run in a fresh dict, so the user's namespace gains nothing. No vscode import.
 */
import { isDottedName, type KernelDefinition } from '../../shared/goToDefinition';

/** - the key the expression is sent under in user_expressions */
export const DEFINITION_KEY = 'skena_definition';
/** - how long the host waits for the kernel's reply */
export const DEFINITION_TIMEOUT_MS = 3000;

// - runs with g (globals), l (locals) and name in its globals; leaves its reply in `out`. A class
//   defined in a cell has no source file through inspect (its module, __main__, has none in a kernel;
//   3.13+ would read __main__'s own file if it had one): its methods' code objects name the cell's
//   temporary file, and __firstlineno__ (3.13+) or the nearest `class Name` line above them gives the
//   line. Only cell files count there, so a dataclass's generated __repr__ (dataclasses.py) does not.
export const DEFINITION_SOURCE = String.raw`
import builtins, functools, inspect, json, linecache, os, re

HEAD = re.compile(r'\s*(?:async\s+)?(?:def|class)\s+(\w+)')
DOTTED = re.compile(r'[^\W\d]\w*(?:\.[^\W\d]\w*)*')
CELL_FILE = re.compile(r'[\\/]ipykernel_\d+[\\/]\d+\.py$')

def lookup(name):
    first, *rest = name.split('.')
    if first in l:
        obj = l[first]
    elif first in g:
        obj = g[first]
    else:
        try:
            obj = getattr(builtins, first)
        except AttributeError:
            raise NameError("name '%s' is not defined" % first) from None
    for i, part in enumerate(rest):
        if i == len(rest) - 1:
            try:
                obj = inspect.getattr_static(obj, part)
                break
            except AttributeError:
                pass
        obj = getattr(obj, part)
    return obj

def unwrap(obj):
    for _ in range(20):
        if isinstance(obj, property) and obj.fget is not None:
            obj = obj.fget
        elif isinstance(obj, (classmethod, staticmethod)):
            obj = obj.__func__
        elif isinstance(obj, (functools.partial, functools.partialmethod, functools.cached_property)):
            obj = obj.func
        elif inspect.ismethod(obj):
            obj = obj.__func__
        else:
            break
    try:
        obj = inspect.unwrap(obj)
    except ValueError:
        pass
    return obj

def target(obj):
    obj = unwrap(obj)
    if inspect.ismodule(obj) or inspect.isclass(obj) or inspect.isroutine(obj) or inspect.iscode(obj):
        return obj
    return type(obj)

def cell_file(file):
    return bool(CELL_FILE.search(file)) or (file in linecache.cache and not os.path.isfile(file))

def class_place(cls):
    codes = []
    for v in vars(cls).values():
        f = unwrap(v)
        code = getattr(f, '__code__', None)
        if code is not None and getattr(f, '__qualname__', '').startswith(cls.__qualname__ + '.') and cell_file(code.co_filename):
            codes.append(code)
    if not codes:
        return None
    file = codes[0].co_filename
    first = getattr(cls, '__firstlineno__', None)
    if first is None:
        lines = linecache.getlines(file)
        top = min(c.co_firstlineno for c in codes if c.co_filename == file)
        head = re.compile(r'\s*class\s+' + re.escape(cls.__name__) + r'\b')
        first = next((i + 1 for i in range(min(top, len(lines)) - 1, -1, -1) if head.match(lines[i])), None)
    return None if first is None else (file, first)

def where(name):
    if not DOTTED.fullmatch(name):
        return {'ok': False, 'error': 'not a dotted name'}
    obj = target(lookup(name))
    if inspect.ismodule(obj):
        file = inspect.getsourcefile(obj)
        if not file:
            return {'ok': False, 'error': 'no source'}
        return {'ok': True, 'file': file, 'line': 1, 'col': 1, 'exists': os.path.isfile(file)}
    place = class_place(obj) if inspect.isclass(obj) else None
    if place is not None:
        file, start = place
        lines = inspect.getblock(linecache.getlines(file)[start - 1:])
    else:
        try:
            file = inspect.getsourcefile(obj)
            lines, start = inspect.getsourcelines(obj)
        except (OSError, TypeError):
            return {'ok': False, 'error': 'no source'}
    if not file:
        return {'ok': False, 'error': 'no source'}
    line, col = start, len(lines[0]) - len(lines[0].lstrip()) + 1
    for i, text in enumerate(lines):
        m = HEAD.match(text)
        if m:
            line, col = start + i, m.start(1) + 1
            break
    exists = os.path.isfile(file)
    out = {'ok': True, 'file': file, 'line': line, 'col': col, 'exists': exists}
    if cell_file(file):
        out['cell'] = ''.join(linecache.getlines(file))
        out['start'] = start
        out['count'] = len(lines)
    return out

class Reply:
    def __init__(self, value):
        self.value = value
    def _repr_json_(self):
        return self.value
    def __repr__(self):
        return json.dumps(self.value)

try:
    out = Reply(where(name))
except Exception as e:
    out = Reply({'ok': False, 'error': type(e).__name__ + ': ' + str(e)})
`;

/** - the expression that looks up `name`; throws unless `name` is names and dots only */
export function definitionExpression(raw: string): string {
  // - Python stores identifiers NFKC-normalised (Ⅻ = 1 binds XII)
  const name = raw.normalize('NFKC');
  if (!isDottedName(name)) throw new Error(`not a dotted name: ${JSON.stringify(raw)}`);
  // - a JSON string is a valid Python string literal; globals() and locals() are those of the
  //   user_expressions eval, the user's namespace
  return `(lambda d: (exec(${JSON.stringify(DEFINITION_SOURCE)}, d), d['out'])[1])({'g': globals(), 'l': locals(), 'name': ${JSON.stringify(name)}})`;
}

/** - why the kernel gave no place: its own words ('no source', 'NameError: …'), or what was wrong with the reply */
export type KernelAnswer = { ok: true; def: KernelDefinition } | { ok: false; error: string };

/**
 * The definition in one user_expressions entry of an execute_reply ({ status, data }): the
 * application/json data, else the text/plain one parsed as JSON.
 */
export function parseDefinitionValue(entry: unknown): KernelAnswer {
  const e = entry as { status?: unknown; data?: Record<string, unknown>; ename?: unknown; evalue?: unknown } | null;
  if (!e || typeof e !== 'object') return { ok: false, error: 'no reply' };
  if (e.status !== 'ok' || !e.data) return { ok: false, error: `${String(e.ename ?? 'error')}: ${String(e.evalue ?? '')}` };
  let v: unknown = e.data['application/json'];
  if (v === undefined && typeof e.data['text/plain'] === 'string') {
    try { v = JSON.parse(e.data['text/plain']); } catch { return { ok: false, error: 'unreadable reply' }; }
  }
  const r = v as (Partial<KernelDefinition> & { ok?: unknown; error?: unknown }) | null;
  if (!r || typeof r !== 'object') return { ok: false, error: 'unreadable reply' };
  if (r.ok !== true) return { ok: false, error: typeof r.error === 'string' ? r.error : 'unreadable reply' };
  if (typeof r.file !== 'string' || typeof r.line !== 'number' || typeof r.col !== 'number' || typeof r.exists !== 'boolean') return { ok: false, error: 'unreadable reply' };
  const def: KernelDefinition = { file: r.file, line: r.line, col: r.col, exists: r.exists };
  if (typeof r.cell === 'string' && typeof r.start === 'number' && typeof r.count === 'number') {
    def.cell = r.cell;
    def.start = r.start;
    def.count = r.count;
  }
  return { ok: true, def };
}
