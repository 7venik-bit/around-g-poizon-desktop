import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('header V2 patch runs after legacy simple header patch', () => {
  const postinstall = pkg.scripts.postinstall;
  const oldIndex = postinstall.indexOf('patch-simple-header-traffic.mjs');
  const newIndex = postinstall.indexOf('patch-header-simple-actions-v2.mjs');
  assert.ok(oldIndex >= 0);
  assert.ok(newIndex > oldIndex);
});
