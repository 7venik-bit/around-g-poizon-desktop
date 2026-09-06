import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');

test('compact header actions prevent clipping and preserve lamp sequence', async () => {
  const patch = await read('scripts/patch-header-simple-actions-v2.mjs');
  const pkg = JSON.parse(await read('package.json'));

  assert.match(pkg.scripts.postinstall, /patch-header-simple-actions-v2\.mjs/);
  assert.match(patch, /official-domain-audit-toggle::after\{content:'공식몰 점검'/);
  assert.match(patch, /weekly-site-health-run::after\{content:'서버 점검'/);
  assert.match(patch, /startup-recovery-run::after\{content:'POIZON 확인'/);
  assert.match(patch, /brand-export-folder-select::after\{content:'저장 폴더'/);
  assert.match(patch, /font-size:0!important/);
  assert.match(patch, /max-width:1500px/);
  assert.match(patch, /window-dots\.sourcing i:nth-child\(1\)\{animation-delay:0s!important\}/);
  assert.match(patch, /window-dots\.sourcing i:nth-child\(2\)\{animation-delay:\.18s!important\}/);
  assert.match(patch, /window-dots\.sourcing i:nth-child\(3\)\{animation-delay:\.36s!important\}/);
});
