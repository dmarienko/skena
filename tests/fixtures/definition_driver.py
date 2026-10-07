# - run by tests/kernel-definition.mjs: evaluates each expression of the JSON list on stdin in one
#   namespace the way IPython evaluates user_expressions (eval, then the text/plain and
#   application/json of the value), prints each as a JSON line, then the names the namespace gained
import array, functools, json, linecache, math, os, sys, tempfile, types

sys.dont_write_bytecode = True

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import definition_fixture as fx

# - IPython's namespace is the dict of a __main__ module without __file__ (checked in a real kernel)
main = types.ModuleType('__main__')
sys.modules['__main__'] = main
ns = main.__dict__
ns.update({'fx': fx, 'functools': functools, 'array': array, 'math': math, 'sys': sys})
# - a cell as ipykernel runs it: compiled under a temporary file name that is only in linecache
CELL = 'import dataclasses, functools\n\n@functools.lru_cache\ndef in_cell(a):\n    return a + 1\n\nclass CellBox:\n    def grow(self):\n        return 2\n\n@dataclasses.dataclass\nclass CellPoint:\n    x: int = 0\n'
NAME = os.path.join(tempfile.gettempdir(), 'ipykernel_4242', '2718281828.py')
linecache.cache[NAME] = (len(CELL), None, CELL.splitlines(True), NAME)
exec(compile(CELL, NAME, 'exec'), ns)
before = set(ns)
for expr in json.load(sys.stdin):
    value = eval(expr, ns, ns)
    print(json.dumps({'status': 'ok', 'data': {'text/plain': repr(value), 'application/json': value._repr_json_()}}))
print(json.dumps({'added': sorted(set(ns) - before), 'cellFile': NAME, 'version': list(sys.version_info[:2])}))
