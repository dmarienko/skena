// - run: npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=tests/.build/jupyter-config.mjs && node --test tests/jupyter-config.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseEnvFile, resolveKernelConfig } from './.build/jupyter-config.mjs';

test('parseEnvFile reads KEY=VALUE, skips comments and blanks', () => {
  const env = parseEnvFile('# comment\nJUPYTER_SERVER_URL=https://h/user/q\n\nJUPYTER_API_TOKEN=tok123\n');
  assert.equal(env.JUPYTER_SERVER_URL, 'https://h/user/q');
  assert.equal(env.JUPYTER_API_TOKEN, 'tok123');
});

test('parseEnvFile strips surrounding quotes and inline whitespace', () => {
  const env = parseEnvFile('JUPYTER_API_TOKEN = "abc" \n');
  assert.equal(env.JUPYTER_API_TOKEN, 'abc');
});

test('resolveKernelConfig prefers the setting when present', () => {
  const out = resolveKernelConfig([{ name: 'a', hubUrl: 'u', token: 't' }], 'JUPYTER_SERVER_URL=x\nJUPYTER_API_TOKEN=y');
  assert.deepEqual(out, [{ name: 'a', hubUrl: 'u', token: 't' }]);
});

test('resolveKernelConfig falls back to env text as a default server', () => {
  const out = resolveKernelConfig(undefined, 'JUPYTER_SERVER_URL=https://h/user/q\nJUPYTER_API_TOKEN=tok');
  assert.deepEqual(out, [{ name: 'default', hubUrl: 'https://h/user/q', token: 'tok' }]);
});

test('resolveKernelConfig returns [] when neither setting nor env present', () => {
  assert.deepEqual(resolveKernelConfig(undefined, null), []);
  assert.deepEqual(resolveKernelConfig([], null), []);
});
