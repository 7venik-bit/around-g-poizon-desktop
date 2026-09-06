import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { applyPoizonScreenSalesToWorkbook } from '../services/poizon-screen-excel-sync.mjs';

test('wide 10000-row worksheet does not hit the JavaScript argument limit and preserves every row', () => {
  const columns = 'ABCDEFGHIJKLMNOP'.split('');
  const head = '<row r="1">' + columns.map((c, i) => `<c r="${c}1" t="inlineStr"><is><t>${i === 0 ? 'SPU ID' : '원본 ' + c}</t></is></c>`).join('') + '</row>';
  const rows = Array.from({ length: 10000 }, (_, i) => {
    const n = i + 2; return `<row r="${n}">` + columns.map((c, j) => `<c r="${c}${n}"><v>${j === 0 ? 11 : j}</v></c>`).join('') + '</row>';
  });
  const buffer = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData>' + head + rows.join('') + '</sheetData></worksheet>') }));
  const p = { spuId: '11', sales30dRaw: '100+', hasSalesData: true, localSales30dRaw: '83', hasLocalSalesData: true };
  const result = applyPoizonScreenSalesToWorkbook(buffer, [p]);
  assert.equal(result.ok, true, result.message); assert.equal(result.changedRows, 10000); assert.equal(result.changedCells, 20000);
  const xml = strFromU8(unzipSync(result.buffer)['xl/worksheets/sheet1.xml']);
  assert.equal([...xml.matchAll(/<row\b/g)].length, 10001);
  assert.ok(xml.includes('<c r="P10001"><v>15</v></c>'));
  assert.equal(applyPoizonScreenSalesToWorkbook(result.buffer, [p]).changedRows, 0);
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
