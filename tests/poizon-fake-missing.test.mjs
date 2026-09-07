import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPageCrossCheck } from '../services/live-poizon-crosscheck.mjs';

const source = (china, local) => ({ spuId:'1001', articleNumber:'ITEM1001', sales30dRaw:china, localSales30dRaw:local, sales30d:Number(String(china).replace(/[^\d.]/g,'')) || 0, localSales30d:Number(String(local).replace(/[^\d.]/g,'')) || 0, hasSalesData:true, hasLocalSalesData:true });
const excel = (china, local) => ({ spuId:'1001', articleNumber:'ITEM1001', sales30dRaw:china, localSales30dRaw:local, hasSalesData:true, hasLocalSalesData:true, sourceRowNumber:2 });

test('slash-separated recent30 option values are aggregate evidence, not fake missing', () => {
  const session = createPageCrossCheck({ runId:'fake-missing-1', excelProducts:[excel('5 / 7 / 35 / 25 / 30', '32 / 28 / 7 / 1')], conditions:{} });
  const result = session.acceptPage([source('100+', '68')], { pageNum:1, pageCount:1 });
  const row = result.rows[0];
  assert.equal(row.matched, true);
  assert.equal(row.excelChinaState, 'aggregate');
  assert.equal(row.excelLocalState, 'aggregate');
  assert.equal(row.equal, true);
  assert.equal(row.autoCorrectionBlocked, true);
  assert.doesNotMatch(row.status, /누락 \d+개/);
  assert.match(row.status, /실제 누락 아님/);
  assert.match(row.excelChina, /합계범위 102/);
  assert.match(row.excelLocal, /합계범위 68/);
});

test('compound option values that do not fit POIZON parent value are review-needed, never missing or auto-written', () => {
  const session = createPageCrossCheck({ runId:'fake-missing-2', excelProducts:[excel('10 / 20', '3 / 4')], conditions:{} });
  const result = session.acceptPage([source('100+', '20')], { pageNum:1, pageCount:1 });
  const row = result.rows[0];
  assert.equal(row.matched, true);
  assert.equal(row.equal, false);
  assert.equal(row.autoCorrectionBlocked, true);
  assert.doesNotMatch(row.status, /판매량 누락|Excel 누락/);
  assert.match(row.status, /실제 누락 아님/);
});

test('shipping guards exclude compound evidence from both page checkpoint and final whole-file overwrite', async () => {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const review = await readFile(new URL('../services/poizon-review-session.mjs', import.meta.url), 'utf8');
  assert.match(main, /POIZON_FAKE_MISSING_AUTOWRITE_GUARD/);
  assert.match(main, /!livePage\.rows\?\.\[index\]\?\.autoCorrectionBlocked/);
  assert.match(review, /POIZON_FAKE_MISSING_FINAL_GUARD/);
  assert.match(review, /!coverage\.rows\?\.\[index\]\?\.autoCorrectionBlocked/);
});
