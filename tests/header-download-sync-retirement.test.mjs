import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { retireDownloadSyncMarkup, applyRetiredDownloadSync, RETIRED_SYNC_CSS } from '../scripts/patch-retire-download-sync.mjs';

const fixture = `<!doctype html><html lang="ko"><head><link rel="stylesheet" href="./style.css"></head><body>
<section class="shell"><header><div class="header-actions">
<button id="notification-open">알림 <b id="notification-count">60</b></button>
<div class="update-anchor"><button id="update-check">자동 업데이트</button></div>
<div class="download-sync-anchor"><button id="import-button" type="button">다운로드 파일 동기화</button>
<div id="excel-sync-progress" class="header-sync-progress" hidden aria-live="polite"><span>동기화 대기</span><em><i></i></em></div></div>
<button id="export-button">전체 백업</button></div></header>
<main><span id="frequent-brand-count">36개</span><button id="poizon-review-brand-start">POIZON 대조</button></main></section></body></html>`;
const tagFor = (html, id) => html.match(new RegExp('<[^>]+\\sid="' + id + '"[^>]*>'))?.[0] || '';

test('download sync is excluded from layout, focus and the accessibility tree', () => {
  const html = retireDownloadSyncMarkup(fixture);
  const anchor = html.match(/<div class="download-sync-anchor"[^>]*>/)?.[0] || '';
  assert.match(anchor, /hidden=""/);
  assert.match(anchor, /inert=""/);
  assert.match(anchor, /aria-hidden="true"/);
  assert.match(tagFor(html, 'import-button'), /disabled=""/);
  assert.match(tagFor(html, 'import-button'), /tabindex="-1"/);
  assert.match(tagFor(html, 'excel-sync-progress'), /hidden=""/);
});

test('only the obsolete action changes; notifications, updates, backups and review remain', () => {
  const html = retireDownloadSyncMarkup(fixture);
  for (const id of ['notification-open', 'notification-count', 'update-check', 'export-button', 'poizon-review-brand-start', 'frequent-brand-count']) {
    assert.equal(tagFor(html, id), tagFor(fixture, id));
  }
  assert.match(html, />36개<\/span>/);
  assert.equal((html.match(/id="import-button"/g) || []).length, 1, 'legacy DOM reference stays valid');
});

test('reapplying installation does not duplicate links or attributes', () => {
  const once = retireDownloadSyncMarkup(fixture);
  assert.equal(retireDownloadSyncMarkup(once), once);
  assert.equal((once.match(/id="retired-download-sync-styles"/g) || []).length, 1);
});

test('unknown or duplicate control markup stops the patch rather than guessing', () => {
  assert.throws(() => retireDownloadSyncMarkup('<html><head></head></html>'), /Unexpected download sync markup/);
  assert.throws(() => retireDownloadSyncMarkup(fixture.replace('</header>', '<button id="import-button"></button></header>')), /Unexpected download sync markup/);
});

test('dedicated CSS overrides legacy display:flex without styling unrelated controls', () => {
  assert.match(RETIRED_SYNC_CSS, /body \.shell > header \.header-actions > \.download-sync-anchor/);
  assert.match(RETIRED_SYNC_CSS, /display: none !important/);
  assert.doesNotMatch(RETIRED_SYNC_CSS, /notification-open|update-check|export-button|window-dots|poizon-review-brand-start/);
});

test('patch writes only presentation files and preserves renderer and workbook bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retired-sync-'));
  try {
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src/index.html'), fixture);
    const renderer = 'const load = () => window.aroundG.listBrandExportFiles();';
    const workbook = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x36, 0x30]);
    await writeFile(join(dir, 'src/renderer.js'), renderer);
    await writeFile(join(dir, 'original.xlsx'), workbook);
    const root = pathToFileURL(dir + '/');
    await applyRetiredDownloadSync(root);
    const first = await readFile(join(dir, 'src/index.html'), 'utf8');
    await applyRetiredDownloadSync(root);
    assert.equal(await readFile(join(dir, 'src/index.html'), 'utf8'), first);
    assert.equal(await readFile(join(dir, 'src/retired-download-sync.css'), 'utf8'), RETIRED_SYNC_CSS);
    assert.equal(await readFile(join(dir, 'src/renderer.js'), 'utf8'), renderer);
    assert.deepEqual(await readFile(join(dir, 'original.xlsx')), workbook);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('installed application includes the retired control styling and explicit POIZON review', async () => {
  const root = new URL('../', import.meta.url);
  const html = await readFile(new URL('src/index.html', root), 'utf8');
  assert.match(html, /id="retired-download-sync-styles"/);
  assert.match(tagFor(html, 'import-button'), /disabled=""/);
  const installedCss = (await readFile(new URL('src/retired-download-sync.css', root), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(installedCss, RETIRED_SYNC_CSS.replace(/\r\n/g, '\n'));
  const renderer = await readFile(new URL('src/renderer.js', root), 'utf8');
  assert.match(renderer, /poizon-review-brand-start/);
  assert.match(renderer, /runPoizonReviewBatch/);
  assert.match(renderer, /listBrandExportFiles/);
  assert.match(renderer, /add\("poizon-review-brand-start", "상품 대조", document\.querySelector\("\.header-actions"\)\)/);
});
