import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syncPoizonPageCheckpoint } from '../services/poizon-page-checkpoint.mjs';

test('review UI keeps existing products uncolored and marks only true Excel-missing rows red', async () => {
  const source = await readFile(new URL('../src/live-poizon-crosscheck.js', import.meta.url), 'utf8');
  assert.match(source, /tr\.live-missing\{background:#fde8e8\}/);
  assert.match(source, /!r\.matched && !r\.identityConflict \? 'live-missing' : ''/);
  assert.doesNotMatch(source, /r\.equal \? '' : 'live-different'/);
});

test('page review wording does not imply automatic continuation while data is unresolved', async () => {
  const view = await readFile(new URL('../src/live-poizon-crosscheck.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../services/live-poizon-crosscheck.mjs', import.meta.url), 'utf8');
  assert.match(view, /수정\/저장\/재검증 완료 전에는 다음 페이지로 이동하지 않습니다/);
  assert.doesNotMatch(service, /SPU 자동수정 제외 · 다음 페이지 진행/);
});

test('a page cannot be considered complete when disk reread still differs', async () => {
  let current = Buffer.from('original');
  const fs = {
    readFile: async () => Buffer.from(current),
    copyFile: async () => {},
    writeFile: async (_path, value) => { current = Buffer.from(value); },
  };
  const applyWorkbook = () => ({
    ok: true,
    changed: true,
    reverified: true,
    changedRows: 1,
    changedCells: 1,
    buffer: Buffer.from('changed'),
  });
  const result = await syncPoizonPageCheckpoint({
    filePath: 'source.xlsx',
    products: [{ spuId: '1' }],
    pageNum: 7,
    fs,
    applyWorkbook,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAGE_CHECKPOINT_REREAD_MISMATCH');
  assert.match(result.message, /다음 페이지로 이동하지 않습니다/);
});
