import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('layout stylesheet is installed once after earlier styles', async () => {
  const html = await read('src/index.html');
  assert.equal((html.match(/id="header-brand-layout-styles"/g) || []).length, 1);
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /header-brand-layout\.css">\s*$/);
});
test('content-sized update wrapper and title count cannot wrap', async () => {
  const css = await read('src/header-brand-layout.css');
  assert.match(css, /\.header-actions > \.update-anchor\s*\{[^}]*width: max-content !important/s);
  assert.match(css, /#frequent-brand-title,\s*#frequent-brand-count\s*\{[^}]*white-space: nowrap !important/s);
  assert.match(css, /\.brand-list-group-heading\s*\{[^}]*flex-wrap: wrap !important/s);
  assert.doesNotMatch(css, /window-dots|animation:|#import-button|download-sync-anchor/);
});
test('patch is idempotent and touches no renderer or workbook data', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'header-brand-patch-'));
  try {
    await mkdir(join(temp, 'scripts')); await mkdir(join(temp, 'src'));
    await writeFile(join(temp, 'scripts/patch-header-brand-layout.mjs'), await read('scripts/patch-header-brand-layout.mjs'));
    await writeFile(join(temp, 'src/header-brand-layout.css'), await read('src/header-brand-layout.css'));
    await writeFile(join(temp, 'src/index.html'), '<html><head><link rel="stylesheet" href="./style.css"></head><body>unchanged</body></html>');
    await writeFile(join(temp, 'src/renderer.js'), 'unchanged renderer');
    await writeFile(join(temp, 'workbook.xlsx'), Buffer.from([0,1,255,37]));
    const run = () => { const r=spawnSync(process.execPath,[join(temp,'scripts/patch-header-brand-layout.mjs')],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr); };
    run(); const first=await readFile(join(temp,'src/index.html'),'utf8'); run();
    assert.equal(await readFile(join(temp,'src/index.html'),'utf8'),first);
    assert.equal(await readFile(join(temp,'src/renderer.js'),'utf8'),'unchanged renderer');
    assert.deepEqual(await readFile(join(temp,'workbook.xlsx')),Buffer.from([0,1,255,37]));
    assert.match(first, /<body>unchanged<\/body>/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
test('integrated layout is covered by install verification', async () => {
  const pkg=JSON.parse(await read('package.json'));
  const verifier=await read('scripts/verify-integrated-source.mjs');
  assert.match(pkg.scripts.postinstall,/verify-integrated-source\.mjs/);
  assert.match(verifier,/header-brand-layout-styles/);
});
