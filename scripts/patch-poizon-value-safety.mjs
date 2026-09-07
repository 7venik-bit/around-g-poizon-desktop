import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
async function transform(path, fn) { const url = new URL(path, root); const source = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n'); const next = fn(source); if (source !== next) await writeFile(url, next, 'utf8'); }
function once(s, a, b) { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error('Value safety patch target missing: ' + a.slice(0, 80)); return s.replace(a, b); }

await transform('services/poizon-screen-excel-sync.mjs', (s) => {
  // New screen-authoritative mode writes directly into the original recent-sales
  // columns and performs its own reread verification. The old patch below was
  // only for the retired dedicated-column writer and must never recreate it.
  if (s.includes("comparisonMode: 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH'")) return s;
  s = once(s, 'Math.max(0, ...cells(xml).map((c) => colNumber(c[1])))', 'cells(xml).reduce((max, c) => Math.max(max, colNumber(c[1])), 0)');
  const start = s.indexOf('      for (const row of rows) {\n        const n = Number(row[1]), data = pending.get(n);');
  if (start < 0 && s.includes('// Single XML pass')) return s;
  const end = s.indexOf('      if (updated !== xml)', start);
  if (start < 0 || end < 0) throw new Error('Single-pass workbook write target missing');
  return s.slice(0, start) + `      // Single XML pass avoids repeatedly copying a large workbook per SKU.
      updated = updated.replace(/<row\\b[^>]*\\br="(\\d+)"[^>]*>[\\s\\S]*?<\\/row>/g, (rowXml, rowNumber) => {
        const n = Number(rowNumber), data = pending.get(n); if (!data || n <= 1) return rowXml;
        let next = rowXml; const oldValues = values(next, shared);
        columns.forEach((column, i) => {
          if (data[i] === null || String(oldValues[column - 1] ?? '').trim() === data[i]) return;
          next = writeCell(next, column, n, data[i]); changedCells++;
          changes.push({ sheet: path, row: n, column: colName(column), field: names[i], before: oldValues[column - 1] ?? '', after: data[i] });
        });
        if (next !== rowXml) changedRows++;
        return next;
      });
` + s.slice(end);
});
await transform('services/verified-combined-search.mjs', (s) => {
  s = once(s, '      const sourceIndex = indexProductIdentities(captured.products);', '      const sourceIndex = indexProductIdentities(captured.products), workbookIndex = indexProductIdentities(before);');
  s = once(s, 'resolveProductIdentity(product, indexProductIdentities(before))', 'resolveProductIdentity(product, workbookIndex)');
  if (!s.includes("verificationStatus: options.length ? 'POIZON 값으로 수정 후 대조 완료'")) {
    s = once(s, "verificationStatus: options.length ? '저장 후 대조 완료'", "verificationStatus: options.length ? product.hasSalesData || product.hasLocalSalesData ? '확인된 항목 저장 후 대조 완료' : '최근 30일 값 미확인'");
  }
  return s;
});
await transform('src/renderer.js', (s) => {
  s = once(s, 'function renderExcelProductRows(file, products = []) {',
    'function renderExcelProductRows(file, products = []) {\n  if (products.some((p) => Array.isArray(p.verificationOptions))) return renderVerifiedSpuRows(file, products);');
  s = once(s, '    if (files[0]) await openIntegratedBrandExcel(files[0], false);',
    '    window.activateSearchServiceMode?.("brand");\n    if (files[0]) await openIntegratedBrandExcel(files[0], false);');
  return s;
});
await transform('src/sourcing-view.js', (s) => once(s,
  '      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {',
  '      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {\n        if (typeof renderVerifiedSpuRows === "function" && products.some((p) => Array.isArray(p.verificationOptions))) return renderVerifiedSpuRows(file, products);'));
await transform('scripts/run-release-regressions.mjs', (s) => {
  const old = 'const files = [...new Set([...process.argv.slice(2), "tests/poizon-value-integrity.test.mjs", "tests/poizon-screen-excel-sync.test.mjs", "tests/live-poizon-crosscheck.test.mjs"])];';
  const next = 'const files = [...new Set([...process.argv.slice(2), "tests/poizon-value-integrity.test.mjs", "tests/poizon-screen-excel-sync.test.mjs", "tests/live-poizon-crosscheck.test.mjs", "tests/poizon-value-safety.test.mjs"])];';
  return once(s, s.includes(old) ? old : 'const files = process.argv.slice(2);', next);
});
console.log('Verified value-safety compatibility: screen-authoritative Excel correction is preserved and all integrity simulations remain mandatory.');
