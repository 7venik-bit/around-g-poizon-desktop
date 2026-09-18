import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('official Open, exact manual links, and credential recovery survive every release transformation', async t => {
  const root = new URL('../', import.meta.url);
  const folder = await mkdtemp(join(tmpdir(), 'aroundg-open-account-package-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const path of ['main.mjs', 'preload.cjs', 'bootstrap.mjs', 'package.json', 'src', 'services', 'relay', 'scripts', 'tests']) {
    await cp(new URL(path, root), join(folder, path), { recursive: true });
  }
  await symlink(fileURLToPath(new URL('node_modules', root)), join(folder, 'node_modules'), 'junction');
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8');
  const scripts = [...workflow.matchAll(/^\s+run: node (scripts\/(?:patch|verify)-[a-z0-9-]+\.mjs)\s*$/gm)].map(m => m[1]);
  assert.ok(scripts.length > 20);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const run = args => {
    try { return execFileSync(process.execPath, args, { cwd: folder, env: childEnv, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) { assert.fail(`${args.join(' ')}\n${error.stdout || ''}\n${error.stderr || ''}`); }
  };
  for (const script of scripts) run([script]);
  for (const path of ['main.mjs', 'src/renderer.js', 'src/domestic-inline-results.js', 'src/sourcing-view.js']) run(['--check', path]);
  const output = run(['--test', '--test-reporter=tap', 'tests/retailer-open-account-regression.test.mjs', 'tests/naver-save-login.test.mjs', 'tests/domestic-retailer-runtime.test.mjs', 'tests/store-save-recovery.test.mjs']);
  assert.match(output, /# tests [1-9]\d*/);
  assert.match(output, /# fail 0/);
});
