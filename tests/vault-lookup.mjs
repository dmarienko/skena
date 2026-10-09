// - run: npx esbuild src/extension/mcp/vaultLookup.ts --bundle --platform=node --format=esm --main-fields=module,main --outfile=tests/.build/vaultLookup.mjs && node --test tests/vault-lookup.mjs
// - scratch folders under the OS temp dir only; no .canvas file is written
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chooseVaults, findWorkspaceFile, parseWorkspaceFile, requestRelayVaults, loadVaults, notConfiguredText, RELAY_CACHE_MS } from './.build/vaultLookup.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'skena-vault-lookup-'));
const HOME = '/home/u';
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

// - the user's factors.code-workspace, token values replaced: comments, trailing commas, a ~ vault path
const USER_WORKSPACE = `{
	"folders": [
		{
			"path": "factors"
		}
	],
	"settings": {
		"skena.ai.provider": "harness",
		"skena.ai.model": "opus",
		// "skena.ai.model": "fable",
		"skena.vaults": [
			{
				"name": "crtx",
				"path": "~/projects/crtx/",
			}
		],
		"skena.knowledge.servers": [
			{ "name": "crtx", "kind": "crtx", "url": "http://aurora-1:8788/mcp", "token": "x" }
		],
		"skena.knowledge.refreshAfterHours": 24,
	// "skena.vaultDirectories": [ "." ]
	}
}
`;

// - a relay that answers POST /vaults like run-ipc.ts, counting what it is asked
function fakeRelay(reply) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, token: req.headers['x-skena-token'] });
      if (reply === 'never') return;
      if (typeof reply === 'number') { res.statusCode = reply; res.end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ vaults: typeof reply === 'function' ? reply() : reply }));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, seen, server })));
}
const relays = [];
after(() => { for (const r of relays) r.server.closeAllConnections?.(), r.server.close(); });
const relay = async reply => { const r = await fakeRelay(reply); relays.push(r); return r; };

const A = { name: 'a', path: '/a' }, B = { name: 'b', path: '/b' }, C = { name: 'c', path: '/c' };
// - a lookup step that records being read
const stepper = () => {
  const read = [];
  const step = (where, vaults) => () => { read.push(where); return { where, vaults, note: vaults ? 'has vaults' : 'no skena.vaults' }; };
  return { read, step };
};

test('1. the extension\'s list is chosen; the settings files and the workspace file are then not read', async () => {
  const { read, step } = stepper();
  const got = await chooseVaults([step('extension', [A]), step('settings', [B]), step('workspace', [C])]);
  assert.deepEqual(got.vaults, [A]);
  assert.deepEqual(read, ['extension']);
  assert.deepEqual(got.looked.map(s => s.where), ['extension']);
});

test('2. with no answer from the extension the settings files are chosen, and without skena.vaults there the workspace file', async () => {
  let s = stepper();
  assert.deepEqual((await chooseVaults([s.step('extension', null), s.step('settings', [B]), s.step('workspace', [C])])).vaults, [B]);
  assert.deepEqual(s.read, ['extension', 'settings']);
  s = stepper();
  assert.deepEqual((await chooseVaults([s.step('extension', null), s.step('settings', null), s.step('workspace', [C])])).vaults, [C]);
  assert.deepEqual(s.read, ['extension', 'settings', 'workspace']);
});

test('3. an empty list from the extension is final: the extension has no vaults', async () => {
  const { read, step } = stepper();
  assert.deepEqual((await chooseVaults([step('extension', []), step('settings', [B])])).vaults, []);
  assert.deepEqual(read, ['extension']);
});

test('4. no list anywhere: no vaults, and every place looked at, in order', async () => {
  const { step } = stepper();
  const got = await chooseVaults([step('extension', null), step('settings', null), step('workspace', null)]);
  assert.deepEqual(got.vaults, []);
  assert.deepEqual(got.looked.map(s => s.where), ['extension', 'settings', 'workspace']);
});

test('5. the user\'s workspace file parses: comments, trailing commas, its folder resolved from its own folder, the ~ vault path expanded without its trailing slash', () => {
  const got = parseWorkspaceFile(USER_WORKSPACE, '/home/u/projects/factors.code-workspace', HOME);
  assert.deepEqual(got.folders, ['/home/u/projects/factors']);
  assert.deepEqual(got.vaults, [{ name: 'crtx', path: '/home/u/projects/crtx' }]);
});

test('6. a workspace file without skena.vaults has no list (null), not an empty one; a folder may be absolute or a file:// uri', () => {
  const got = parseWorkspaceFile(JSON.stringify({ folders: [{ path: '/abs/one' }, { uri: 'file:///abs/two' }, { uri: 'vscode-remote://ssh/x' }], settings: {} }), '/w/x.code-workspace', HOME);
  assert.equal(got.vaults, null);
  assert.deepEqual(got.folders, ['/abs/one', '/abs/two']);
});

test('7. the workspace file in a parent folder whose folders hold the canvas is found; one whose folders do not is skipped', () => {
  const root = join(TMP, 't7', 'projects');
  put(join(root, 'factors.code-workspace'), USER_WORKSPACE);
  put(join(root, 'aaa-other.code-workspace'), JSON.stringify({ folders: [{ path: 'other' }] }));
  const canvas = join(root, 'factors', 'research', 'review', 'f.cvs.json');
  mkdirSync(dirname(canvas), { recursive: true });
  assert.equal(findWorkspaceFile(canvas, [dirname(canvas)]), join(root, 'factors.code-workspace'));
});

test('8. the nearest workspace file holding the canvas wins', () => {
  const root = join(TMP, 't8', 'projects');
  put(join(root, 'factors.code-workspace'), USER_WORKSPACE);
  put(join(root, 'factors', 'research', 'inner.code-workspace'), JSON.stringify({ folders: [{ path: '.' }] }));
  const canvas = join(root, 'factors', 'research', 'review', 'f.cvs.json');
  mkdirSync(dirname(canvas), { recursive: true });
  assert.equal(findWorkspaceFile(canvas, [dirname(canvas)]), join(root, 'factors', 'research', 'inner.code-workspace'));
});

test('9. the parent folders of the second start (the working folder) are searched too; none holding the canvas gives null', () => {
  const root = join(TMP, 't9');
  put(join(root, 'ws', 'proj.code-workspace'), JSON.stringify({ folders: [{ uri: pathToFileURL(join(root, 'elsewhere')).href }] }));
  const canvas = join(root, 'elsewhere', 'x', 'f.cvs.json');
  mkdirSync(dirname(canvas), { recursive: true });
  mkdirSync(join(root, 'ws', 'sub'), { recursive: true });
  assert.equal(findWorkspaceFile(canvas, [dirname(canvas)]), null);
  assert.equal(findWorkspaceFile(canvas, [dirname(canvas), join(root, 'ws', 'sub')]), join(root, 'ws', 'proj.code-workspace'));
});

test('10. a relay that answers gives its list, asked by POST /vaults with the token', async () => {
  const r = await relay([{ name: 'crtx', path: '/home/u/projects/crtx' }]);
  assert.deepEqual(await requestRelayVaults(r.port, 'tok', 500, HOME), { kind: 'answer', vaults: [{ name: 'crtx', path: '/home/u/projects/crtx' }] });
  assert.deepEqual(r.seen, [{ method: 'POST', url: '/vaults', token: 'tok' }]);
});

test('11. nothing listening at the port: no list, without waiting for the timeout', async () => {
  const r = await fakeRelay([]);
  await new Promise(res => r.server.close(res));
  const t0 = Date.now();
  const got = await requestRelayVaults(r.port, 'tok', 5000, HOME);
  assert.equal(got.kind, 'none');
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test('12. a relay that refuses (an extension without /vaults answers 403): no list', async () => {
  const r = await relay(403);
  const got = await requestRelayVaults(r.port, 'tok', 500, HOME);
  assert.equal(got.kind, 'none');
  assert.match(got.why, /403/);
});

test('13. a relay that does not answer in time: no list once the wait is over', async () => {
  const r = await relay('never');
  const t0 = Date.now();
  const got = await requestRelayVaults(r.port, 'tok', 200, HOME);
  const took = Date.now() - t0;
  assert.equal(got.kind, 'none');
  assert.match(got.why, /no answer within 200 ms/);
  assert.ok(took >= 190 && took < 1000, `${took} ms`);
});

// - the factors layout: a .vscode/settings.json without skena.vaults, the vault in the workspace file one folder up
function factorsTree(name) {
  const root = join(TMP, name, 'projects');
  put(join(root, 'factors', '.vscode', 'settings.json'), '{ "python-envs.pythonProjects": [], }');
  put(join(root, 'factors.code-workspace'), USER_WORKSPACE);
  const canvas = join(root, 'factors', 'research', 'review', 'f.cvs.json');
  mkdirSync(dirname(canvas), { recursive: true });
  return { root, canvas };
}

test('14. loadVaults: the extension\'s list, else skena.vaults in the .vscode settings files, else the workspace file\'s', async () => {
  const { root, canvas } = factorsTree('t14');
  const cwd = join(root, 'factors');
  const r = await relay([{ name: 'crtx', path: '/from/extension' }]);
  let got = await loadVaults(canvas, { relay: { port: r.port, token: 't' }, cwd, home: HOME });
  assert.deepEqual(got.vaults, [{ name: 'crtx', path: '/from/extension' }]);

  got = await loadVaults(canvas, { relay: null, cwd, home: HOME });
  assert.deepEqual(got.vaults, [{ name: 'crtx', path: '/home/u/projects/crtx' }]);
  assert.equal(got.looked.at(-1).where, join(root, 'factors.code-workspace'));

  put(join(root, 'factors', '.vscode', 'settings.local.json'), '{ "skena.vaults": [ { "name": "crtx", "path": "~/local-crtx/" }, ], }');
  got = await loadVaults(canvas, { relay: null, cwd, home: HOME });
  assert.deepEqual(got.vaults, [{ name: 'crtx', path: '/home/u/local-crtx' }]);
});

test('15. the relay\'s answer is kept for a few seconds, then asked again; so is a missing answer', async () => {
  const { root, canvas } = factorsTree('t15');
  let list = [A];
  const r = await relay(() => list);
  const opts = now => ({ relay: { port: r.port, token: 't' }, cwd: root, home: HOME, now });
  const t0 = 1_000_000;
  assert.deepEqual((await loadVaults(canvas, opts(t0))).vaults, [A]);
  list = [B];
  assert.deepEqual((await loadVaults(canvas, opts(t0 + RELAY_CACHE_MS - 1))).vaults, [A]);
  assert.equal(r.seen.length, 1);
  assert.deepEqual((await loadVaults(canvas, opts(t0 + RELAY_CACHE_MS + 1))).vaults, [B]);
  assert.equal(r.seen.length, 2);

  const slow = await relay('never');
  const sopts = now => ({ relay: { port: slow.port, token: 't' }, cwd: root, home: HOME, now, waitMs: 100 });
  await loadVaults(canvas, sopts(t0));
  const t1 = Date.now();
  assert.deepEqual((await loadVaults(canvas, sopts(t0 + 1000))).vaults, [{ name: 'crtx', path: '/home/u/projects/crtx' }]);
  assert.ok(Date.now() - t1 < 90, 'the second call does not wait for the relay again');
  assert.equal(slow.seen.length, 1);
});

test('16. a vault no list names: the text names the vault and each place looked at with what it held', async () => {
  const root = join(TMP, 't16');
  const canvas = join(root, 'p', 'f.cvs.json');
  mkdirSync(dirname(canvas), { recursive: true });
  const lookup = await loadVaults(canvas, { relay: null, cwd: join(root, 'p'), home: HOME });
  assert.deepEqual(lookup.vaults, []);
  const text = notConfiguredText('crtx', lookup);
  assert.match(text, /vault "crtx" not configured/);
  assert.match(text, /skena extension/);
  assert.match(text, /\.vscode\/settings\.json/);
  assert.match(text, /\.code-workspace/);
  assert.equal(lookup.looked.length, 3);
});
