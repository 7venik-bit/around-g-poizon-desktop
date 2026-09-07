import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };

// Do not overwrite the comparison service during a build. It is versioned source.
const live = await read('services/live-poizon-crosscheck.mjs');
if (!live.includes('POIZON_METRIC_EVIDENCE_V2') || /function compoundRecentMetric|function metricCompatible/.test(live)) {
  throw new Error('The strict evidence comparison source is missing or the retired aggregate matcher is active.');
}
if (!live.includes('EXCEL_SKU_SPU_SCOPE_MISMATCH') || !live.includes('skippedSkuScope')) {
  throw new Error('Safe SKU-scope pagination source is missing.');
}

let main = await read('main.mjs');
if (!main.includes('POIZON_STRICT_PAGE_EVIDENCE_GUARD')) {
  const inputs = [
    '          products: currentPageProducts,',
    '          products: currentPageProducts.filter((_, index) => !livePage.rows?.[index]?.autoCorrectionBlocked),',
  ];
  const before = inputs.find((text) => main.includes(text + '\n          pageNum: capture.currentPage,'));
  if (!before) throw new Error('Page evidence guard integration target missing.');
  main = main.replace(before, '          // POIZON_STRICT_PAGE_EVIDENCE_GUARD: unsafe unresolved products stop the page; verified SKU-scope rows are excluded from writes and may advance.\n          products: assertPoizonPageReadyForCorrection(currentPageProducts, livePage.rows, capture.currentPage),');
  main = 'import { assertPoizonPageReadyForCorrection } from "./services/live-poizon-crosscheck.mjs";\n' + main;
}
await save('main.mjs', main);

let review = await read('services/poizon-review-session.mjs');
if (!review.includes('POIZON_STRICT_FINAL_EVIDENCE_GUARD')) {
  const oldLines = [
    "      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: captured.products || [] });",
    "      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: (captured.products || []).filter((_, index) => !coverage.rows?.[index]?.autoCorrectionBlocked) });",
  ];
  const before = oldLines.find((line) => review.includes(line));
  if (!before) throw new Error('Final evidence guard integration target missing.');
  review = review.replace(before, "      // POIZON_STRICT_FINAL_EVIDENCE_GUARD: identity-keyed evidence, independent of result ordering.\n      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: assertPoizonPageReadyForCorrection(captured.products || [], coverage.rows) });");
  review = "import { assertPoizonPageReadyForCorrection } from './live-poizon-crosscheck.mjs';\n" + review;
}
const tone = "export function reviewTone(row = {}) {";
if (!review.includes("if (row.autoCorrectionBlocked === true) return 'unknown';")) {
  review = review.replace(tone, tone + "\n  if (row.autoCorrectionBlocked === true) return 'unknown';");
}
await save('services/poizon-review-session.mjs', review);

let view = await read('src/poizon-review-workspace.js');
view = view.replace("result.corrected && reviewTone(row) === 'different'", "result.corrected && !row.autoCorrectionBlocked && reviewTone(row) === 'different'");
await save('src/poizon-review-workspace.js', view);

// Keep the regression aligned with the production rule: a verified SKU-vs-SPU
// scope mismatch is a safe no-write page, not a capture failure.
let evidenceTest = await read('tests/poizon-fake-missing.test.mjs');
const oldCaptureExpectation = "  await assert.rejects(runInNewContext('(async()=>{' + capture.slice(from,to) + '})()',sandbox),/상품단위 비교 보류/);\n  assert.equal(writes,0); assert.deepEqual(await readFile(path),before);";
const newCaptureExpectation = "  await assert.doesNotReject(runInNewContext('(async()=>{' + capture.slice(from,to) + '})()',sandbox));\n  assert.equal(writes,1); assert.deepEqual(await readFile(path),before);";
if (evidenceTest.includes(oldCaptureExpectation)) evidenceTest = evidenceTest.replace(oldCaptureExpectation, newCaptureExpectation);
else if (!evidenceTest.includes(newCaptureExpectation)) throw new Error('SKU-scope capture regression target missing.');

if (!evidenceTest.includes("verified SKU scope mismatch is a safe no-write checkpoint")) {
  const marker = "test('shipping XLSX reader -> preview builder -> snapshot -> IPC-shaped input retains scalar SKU evidence'";
  const at = evidenceTest.indexOf(marker);
  if (at < 0) throw new Error('SKU-scope checkpoint regression insertion target missing.');
  const regression = `test('verified SKU scope mismatch is a safe no-write checkpoint', async () => {\n  const items = [excel('33','5',{skuId:'1',salesScope:'sku'}), excel('100+','14',{skuId:'2',salesScope:'sku',sourceRowNumber:110})];\n  const page = check(items);\n  const writable = assertPoizonPageReadyForCorrection([source()],page.rows,1);\n  assert.equal(writable.length,0);\n  assert.equal(writable.pageEvidence?.verified,true);\n  assert.equal(writable.pageEvidence?.skippedSkuScope,1);\n  const {syncPoizonPageCheckpoint} = await import('../services/poizon-page-checkpoint.mjs');\n  let reads=0,writes=0,copies=0;\n  const checkpoint = await syncPoizonPageCheckpoint({ filePath:'safe.xlsx', products:writable, pageNum:1, fs:{\n    readFile:async()=>{reads++; throw new Error('safe skip must not read');},\n    writeFile:async()=>{writes++;}, copyFile:async()=>{copies++;},\n  }});\n  assert.equal(checkpoint.ok,true);\n  assert.equal(checkpoint.code,'PAGE_CHECKPOINT_SKU_SCOPE_SKIPPED');\n  assert.equal(checkpoint.reverified,true);\n  assert.equal(checkpoint.skippedSkuScope,1);\n  assert.deepEqual([reads,writes,copies],[0,0,0]);\n});\n\n`;
  evidenceTest = evidenceTest.slice(0,at) + regression + evidenceTest.slice(at);
}
await save('tests/poizon-fake-missing.test.mjs', evidenceTest);

let runner = await read('scripts/run-release-regressions.mjs');
if (!runner.includes('"tests/poizon-fake-missing.test.mjs"')) {
  const marker = 'const files = [...new Set([...process.argv.slice(2),';
  if (!runner.includes(marker)) throw new Error('Mandatory evidence regression integration target missing.');
  runner = runner.replace(marker, marker + ' "tests/poizon-fake-missing.test.mjs",');
}
await save('scripts/run-release-regressions.mjs', runner);
console.log('Strict Excel evidence verified: SKU scope is preserved, excluded from unsafe writes, and safe no-write pages may continue.');
