import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { applyPoizonScreenSalesToWorkbook } from '../services/poizon-screen-excel-sync.mjs';

test('wide 10000-row POIZON worksheet preserves every row while correcting original sales cells', () => {
  const columns = 'ABCDEFGHIJKLMNOP'.split('');
  const labels = ['SPU ID','상품 번호','중국 총 판매량','현지 판매자 총 판매량','SKU ID','최근 30일간 평균 거래가'];
  const head = '<row r="1">' + columns.map((c, i) => `<c r="${c}1" t="inlineStr"><is><t>${labels[i] || '원본 ' + c}</t></is></c>`).join('') + '</row>';
  const rows = Array.from({ length: 10000 }, (_, i) => {
    const n = i + 2;
    return `<row r="${n}">` + columns.map((c, j) => {
      const value = j === 0 ? 11 : j === 1 ? 'ITEM-11' : j === 2 ? 1 : j === 3 ? 2 : j;
      return `<c r="${c}${n}"><v>${value}</v></c>`;
    }).join('') + '</row>';
  });
  const sheet = '<worksheet><sheetData>' + head + rows.join('') + '</sheetData></worksheet>';
  const buffer = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
  const p = { spuId: '11', articleNumber: 'ITEM-11', sales30dRaw: '100+', hasSalesData: true, localSales30dRaw: '83', hasLocalSalesData: true };
  const result = applyPoizonScreenSalesToWorkbook(buffer, [p]);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.changedRows, 10000);
  assert.equal(result.changedCells, 20000);
  assert.equal(result.reverified, true);
  const xml = strFromU8(unzipSync(result.buffer)['xl/worksheets/sheet1.xml']);
  assert.equal([...xml.matchAll(/<row\b/g)].length, 10001);
  assert.ok(xml.includes('<c r="P10001"><v>15</v></c>'));
  const second = applyPoizonScreenSalesToWorkbook(result.buffer, [p]);
  assert.equal(second.changedRows, 0);
  assert.equal(second.alreadyMatchedCells, 20000);
});

test('domestic search rerenders keep verified parent metrics separate from size sales in both renderers', async () => {
  const source = await readFile(new URL('../src/sourcing-view.js', import.meta.url), 'utf8');
  const marker = 'const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {';
  const start = source.indexOf(marker) + marker.length, end = source.indexOf('        try {', start);
  assert.ok(start >= marker.length && end > start);
  let called = 0;
  const guard = new Function('file', 'products', 'renderVerifiedSpuRows', source.slice(start, end));
  const output = guard({}, [{ verificationOptions: [{ localTotalSalesRaw: '40' }], localSales30dRaw: '1,400+' }], () => { called++; return ['SPU:11']; });
  assert.equal(called, 1); assert.deepEqual(output, ['SPU:11']);
  const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /function renderExcelProductRows\(file, products = \[\]\) \{\s*if \(products.some\(\(p\) => Array.isArray\(p.verificationOptions\)\)\) return renderVerifiedSpuRows/);
});

test('release regression runner keeps value-integrity simulations mandatory after release patches', async () => {
  const runner = await readFile(new URL('../scripts/run-release-regressions.mjs', import.meta.url), 'utf8');
  assert.match(runner, /tests\/poizon-value-integrity.test.mjs/);
  assert.match(runner, /process.exit/);
});

test('both renderer overrides return the original-row renderer before computing size references', async () => {
  const products = [{originalRow:{headers:['상품명'],values:['원본 상품명']},sourceRowNumber:248}];
  for (const [path, marker] of [
    ['../src/sourcing-view.js','const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {'],
    ['../src/domestic-inline-results.js','const inlineExcelRenderer = function inlineExcelProductRows(file, products = []) {'],
  ]) {
    const source = await readFile(new URL(path,import.meta.url),'utf8');
    const start = source.indexOf(marker)+marker.length, end=source.indexOf('        try {',start);
    assert.ok(start>=marker.length&&end>start);
    const guard = new Function('file','products','renderOriginalExcelRows','renderVerifiedSpuRows',source.slice(start,end));
    let received;
    assert.deepEqual(guard({},products,(_file,rows)=>{received=rows;return ['ROW:248'];},()=>{throw Error('must not group source rows');}),['ROW:248']);
    assert.equal(received,products);
  }
});
