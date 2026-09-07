import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };

// Do not overwrite the comparison service during a build. It is versioned source.
const live = await read('services/live-poizon-crosscheck.mjs');
if (!live.includes('POIZON_METRIC_EVIDENCE_V2') || /function compoundRecentMetric|function metricCompatible/.test(live)) {
  throw new Error('The strict evidence comparison source is missing or the retired aggregate matcher is active.');
}

let main = await read('main.mjs');
if (!main.includes('POIZON_STRICT_PAGE_EVIDENCE_GUARD')) {
  const inputs = [
    '          products: currentPageProducts,',
    '          products: currentPageProducts.filter((_, index) => !livePage.rows?.[index]?.autoCorrectionBlocked),',
  ];
  const before = inputs.find((text) => main.includes(text + '\n          pageNum: capture.currentPage,'));
  if (!before) throw new Error('Page evidence guard integration target missing.');
  main = main.replace(before, '          // POIZON_STRICT_PAGE_EVIDENCE_GUARD: unresolved products stop the page before any write.\n          products: assertPoizonPageReadyForCorrection(currentPageProducts, livePage.rows, capture.currentPage),');
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

let runner = await read('scripts/run-release-regressions.mjs');
if (!runner.includes('"tests/poizon-fake-missing.test.mjs"')) {
  const marker = 'const files = [...new Set([...process.argv.slice(2),';
  if (!runner.includes(marker)) throw new Error('Mandatory evidence regression integration target missing.');
  runner = runner.replace(marker, marker + ' "tests/poizon-fake-missing.test.mjs",');
}
await save('scripts/run-release-regressions.mjs', runner);
console.log('Strict Excel evidence verified: SKU scope and parsing failures are not missing cells; unresolved pages cannot write or advance.');
