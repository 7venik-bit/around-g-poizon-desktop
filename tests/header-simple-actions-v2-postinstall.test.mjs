import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('header V2 source is verified during installation', async () => {
  const verifier = await readFile(new URL('../scripts/verify-integrated-source.mjs', import.meta.url), 'utf8');
  assert.match(pkg.scripts.postinstall, /verify-integrated-source\.mjs/);
  assert.match(verifier, /official-domain-audit-toggle/);
});
