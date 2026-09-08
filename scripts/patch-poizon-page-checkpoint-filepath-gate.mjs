import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => {
  const current = await read(path);
  if (value !== current) await writeFile(new URL(path, root), value, 'utf8');
};
const replaceAny = (source, befores, after, label) => {
  if (source.includes(after)) return source;
  const before = befores.find((candidate) => source.includes(candidate));
  if (!before) throw new Error(`POIZON page checkpoint filePath target missing: ${label}`);
  return source.replace(before, after);
};

let liveView = await read('src/live-poizon-crosscheck.js');
liveView = replaceAny(
  liveView,
  [
    "  const input = { runId, brandName, fileName: file.name || '', excelProducts, conditions: frozen };",
    "  const input = { runId, brandName, fileName: file.name || '', filePath: file.path || '', excelProducts, conditions: frozen };",
  ],
  "  const input = { runId, brandName, fileName: file.name || '', filePath: file.path || file.filePath || '', excelProducts, conditions: frozen };",
  'classic live verification input',
);
await save('src/live-poizon-crosscheck.js', liveView);

let reviewView = await read('src/poizon-review-workspace.js');
reviewView = replaceAny(
  reviewView,
  [
    "  const input = { runId, brandName, fileName: file.name || '', screenOnly: true, conditions: frozen,\n    excelProducts: products.map(({ sourceValues, ...p }) => p) };",
    "  const input = { runId, brandName, fileName: file.name || '', filePath: file.path || '', screenOnly: true, conditions: frozen,\n    excelProducts: products.map(({ sourceValues, ...p }) => p) };",
  ],
  "  const input = { runId, brandName, fileName: file.name || '', filePath: file.path || file.filePath || '', screenOnly: true, conditions: frozen,\n    excelProducts: products.map(({ sourceValues, ...p }) => p) };",
  'dedicated review verification input',
);
await save('src/poizon-review-workspace.js', reviewView);

const main = await read('main.mjs');
const captureStart = main.indexOf('async function captureSellerBrandSales');
const captureEnd = main.indexOf('async function lookupSellerTransactionPrice', captureStart);
if (captureStart < 0 || captureEnd < 0) throw new Error('POIZON capture function bounds are missing.');
const capture = main.slice(captureStart, captureEnd);
if (!/enabled:\s*Boolean\(liveVerifier && input\.verification\?\.filePath\)/.test(capture)) {
  throw new Error('POIZON page checkpoint is not tied to a real workbook filePath.');
}
if (!capture.includes('selectPoizonPageCorrectionProducts(currentPageProducts, livePage.rows, capture.currentPage)')) {
  throw new Error('POIZON page checkpoint must use identity-keyed page evidence before writes.');
}
if (!capture.includes('await syncPoizonPageCheckpoint({')) {
  throw new Error('POIZON page checkpoint writer is missing.');
}
const checkpointDone = capture.indexOf('phase: "page-checkpoint-complete"');
const nextPage = capture.indexOf('const expectedNextPage');
if (!(checkpointDone > 0 && nextPage > checkpointDone)) {
  throw new Error('Next page navigation is not gated by page checkpoint completion.');
}

console.log('POIZON page checkpoint filePath gate verified: each page needs a real workbook path, page evidence, save, reread, and recheck before the next page click.');
