import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { findPoizonColumn } from './poizon-xlsx.mjs';
import { indexProductIdentities, resolveProductIdentity, consistentParentProduct, verifiedParentMetric, VERIFIED_PARENT_HEADERS } from './poizon-product-identity.mjs';

const SHEET = /^xl\/worksheets\/sheet\d+\.xml$/;
const decode = (s = '') => String(s).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colNumber = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
function text(cell = '', shared = []) {
  if (/\bt="s"/.test(cell)) return shared[Number(cell.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '';
  const nodes = [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
  return decode(nodes.length ? nodes.map((m) => m[1]).join('') : cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
}
function cells(row) { return [...row.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)]; }
function values(row, shared) { const result = []; for (const m of cells(row)) result[colNumber(m[1]) - 1] = text(m[0], shared); return result; }
function writeCell(row, column, number, value) {
  const ref = `${colName(column)}${number}`;
  const existing = cells(row).find((m) => m[1] === colName(column));
  if (existing && /<f\b/.test(existing[0])) throw new Error(`검증 열 ${ref}에 수식이 있어 자동 수정하지 않습니다.`);
  const style = existing?.[0].match(/\bs="([^"]+)"/)?.[1];
  const cell = `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  if (existing) return row.replace(existing[0], cell);
  const next = cells(row).find((m) => colNumber(m[1]) > column);
  return next ? row.slice(0, next.index) + cell + row.slice(next.index) : row.replace(/<\/row>$/, cell + '</row>');
}
function fixDimension(xml) {
  let lastColumn = 1, lastRow = 1;
  for (const m of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) { lastColumn = Math.max(lastColumn, colNumber(m[1])); lastRow = Math.max(lastRow, Number(m[2])); }
  const dimension = `<dimension ref="A1:${colName(lastColumn)}${lastRow}"/>`;
  if (/<dimension\b[^>]*\/>/.test(xml)) return xml.replace(/<dimension\b[^>]*\/>/, dimension);
  if (/<sheetPr\b/.test(xml)) return xml.replace(/(<sheetPr\b[^>]*(?:\/>|>[\s\S]*?<\/sheetPr>))/, '$1' + dimension);
  return xml.replace(/(<worksheet\b[^>]*>)/, '$1' + dimension);
}

// Parent metrics are stored in explicitly named NEW columns. Existing totals,
// recent SKU values, price, formulas, styles and option rows are never overwritten.
export function applyPoizonScreenSalesToWorkbook(buffer, screenProducts = []) {
  const archive = unzipSync(new Uint8Array(buffer));
  const paths = Object.keys(archive).filter((p) => SHEET.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!paths.length) return { ok: false, code: 'EXCEL_WORKSHEET_MISSING', message: 'Excel 워크시트를 찾지 못했습니다.' };
  const sharedXml = archive['xl/sharedStrings.xml'] ? strFromU8(archive['xl/sharedStrings.xml']) : '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const index = indexProductIdentities(screenProducts);
  let matchedRows = 0, changedRows = 0, changedCells = 0, unresolvedRows = 0, conflictedRows = 0, productSheets = 0;
  const columnMappings = [], changes = [];
  try {
    for (const path of paths) {
      const xml = strFromU8(archive[path]);
      const rows = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)];
      const header = rows.find((r) => Number(r[1]) === 1);
      if (!header) continue;
      const headers = values(header[0], shared);
      const spu = findPoizonColumn(headers, 'SPU ID', 'SPU_ID', 'SPUID');
      const article = findPoizonColumn(headers, '상품 번호', '상품번호', '상품코드', '품번');
      const brandId = findPoizonColumn(headers, '브랜드 ID', 'Brand ID');
      if (spu < 0 && article < 0) continue;
      productSheets++;
      const pending = new Map();
      for (const row of rows) {
        const n = Number(row[1]); if (n <= 1) continue;
        const v = values(row[0], shared);
        if (!String(v[spu] || v[article] || '').trim()) continue;
        const match = resolveProductIdentity({ spuId: v[spu], articleNumber: v[article], brandId: v[brandId] }, index);
        if (!match.products.length) { unresolvedRows++; continue; }
        const source = consistentParentProduct(match.products);
        if (!source) { conflictedRows++; continue; }
        matchedRows++;
        const data = [verifiedParentMetric(source), verifiedParentMetric(source, true)];
        if (data.some((v) => v !== null)) pending.set(n, data);
      }
      if (!pending.size) continue;
      let highest = Math.max(0, ...cells(xml).map((c) => colNumber(c[1])));
      const names = [VERIFIED_PARENT_HEADERS.china, VERIFIED_PARENT_HEADERS.local];
      const columns = names.map((name) => {
        const matches = headers.map((h, i) => h === name ? i + 1 : -1).filter((i) => i > 0);
        if (matches.length > 1) throw new Error(`중복된 검증 열: ${name}`);
        return matches[0] || ++highest;
      });
      if (highest > 16384) throw new Error('Excel 최대 열 수를 초과해 검증 열을 추가할 수 없습니다.');
      let nextHeader = header[0];
      columns.forEach((column, i) => { if (headers[column - 1] !== names[i]) nextHeader = writeCell(nextHeader, column, 1, names[i]); });
      let updated = xml.replace(header[0], nextHeader);
      for (const row of rows) {
        const n = Number(row[1]), data = pending.get(n); if (!data) continue;
        let next = row[0]; const oldValues = values(next, shared);
        columns.forEach((column, i) => {
          if (data[i] === null || String(oldValues[column - 1] ?? '').trim() === data[i]) return;
          next = writeCell(next, column, n, data[i]); changedCells++;
          changes.push({ sheet: path, row: n, column: colName(column), field: names[i], before: oldValues[column - 1] ?? '', after: data[i] });
        });
        if (next !== row[0]) { changedRows++; updated = updated.replace(row[0], next); }
      }
      if (updated !== xml) archive[path] = strToU8(fixDimension(updated));
      columnMappings.push({ sheet: path, china: colName(columns[0]), local: colName(columns[1]), scope: 'spu', period: 'recent30' });
    }
  } catch (error) {
    return { ok: false, code: 'EXCEL_SAFE_SYNC_REJECTED', message: error.message };
  }
  if (!productSheets) return { ok: false, code: 'EXCEL_PRODUCT_KEY_MISSING', message: '상품번호 또는 SPU ID 열을 찾지 못했습니다.' };
  return { ok: true, changed: changedRows > 0, matchedRows, changedRows, changedCells, unresolvedRows, conflictedRows,
    usedRecentColumns: true, usedDedicatedColumns: true, columnMappings, changes,
    buffer: changedRows ? Buffer.from(zipSync(archive, { level: 6 })) : Buffer.from(buffer) };
}
