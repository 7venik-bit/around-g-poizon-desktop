import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { findPoizonColumn, findPoizonRecentSalesColumns } from './poizon-xlsx.mjs';
import { indexProductIdentities, resolveProductIdentity, consistentParentProduct, verifiedParentMetric } from './poizon-product-identity.mjs';

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
function normalizedValue(value) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim(); }
function writeCell(row, column, number, value) {
  const ref = `${colName(column)}${number}`;
  const existing = cells(row).find((m) => m[1] === colName(column));
  if (existing && /<f\b/.test(existing[0])) throw new Error(`판매량 셀 ${ref}에 수식이 있어 자동 수정하지 않습니다.`);
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

// POIZON 화면값을 최종 기준값으로 사용한다.
// Excel 원본의 대응 최근 30일 판매량 셀을 직접 비교하고, 누락/불일치만 수정한 뒤
// 같은 버퍼를 다시 읽어 값이 실제로 일치하는지 재검증한다.
export function applyPoizonScreenSalesToWorkbook(buffer, screenProducts = []) {
  const archive = unzipSync(new Uint8Array(buffer));
  const paths = Object.keys(archive).filter((p) => SHEET.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!paths.length) return { ok: false, code: 'EXCEL_WORKSHEET_MISSING', message: 'Excel 워크시트를 찾지 못했습니다.' };
  const sharedXml = archive['xl/sharedStrings.xml'] ? strFromU8(archive['xl/sharedStrings.xml']) : '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const index = indexProductIdentities(screenProducts);
  let matchedRows = 0, changedRows = 0, changedCells = 0, unresolvedRows = 0, conflictedRows = 0, productSheets = 0;
  let missingCells = 0, mismatchedCells = 0, alreadyMatchedCells = 0, verifiedCells = 0;
  const columnMappings = [], changes = [], verificationTargets = [];
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

      const salesColumns = findPoizonRecentSalesColumns(headers);
      if (salesColumns.china < 0 && salesColumns.local < 0) {
        return {
          ok: false,
          code: 'EXCEL_RECENT_SALES_COLUMNS_MISSING',
          message: 'Excel에서 최근 30일 판매량 또는 POIZON 원본 판매량 열을 찾지 못했습니다.',
        };
      }
      const columns = [salesColumns.china >= 0 ? salesColumns.china + 1 : -1, salesColumns.local >= 0 ? salesColumns.local + 1 : -1];
      const fields = ['중국 최근 30일 판매량', '현지 판매자 최근 30일 판매량'];
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
        if (data.some((value) => value !== null)) pending.set(n, data);
      }

      let updated = xml;
      for (const row of rows) {
        const n = Number(row[1]), data = pending.get(n); if (!data) continue;
        let next = row[0];
        const oldValues = values(next, shared);
        let rowChanged = false;
        columns.forEach((column, i) => {
          if (column < 1 || data[i] === null) return;
          const before = String(oldValues[column - 1] ?? '').trim();
          const after = String(data[i]).trim();
          if (normalizedValue(before) === normalizedValue(after)) {
            alreadyMatchedCells++;
            verificationTargets.push({ path, row: n, column, field: fields[i], expected: after });
            return;
          }
          if (!before) missingCells++; else mismatchedCells++;
          next = writeCell(next, column, n, after);
          changedCells++;
          rowChanged = true;
          changes.push({
            sheet: path,
            row: n,
            column: colName(column),
            field: fields[i],
            before,
            after,
            reason: before ? 'VALUE_MISMATCH' : 'MISSING_VALUE',
            result: 'POIZON_VALUE_APPLIED',
          });
          verificationTargets.push({ path, row: n, column, field: fields[i], expected: after });
        });
        if (rowChanged) {
          changedRows++;
          updated = updated.replace(row[0], next);
        }
      }
      if (updated !== xml) archive[path] = strToU8(fixDimension(updated));
      columnMappings.push({
        sheet: path,
        china: columns[0] > 0 ? colName(columns[0]) : '',
        local: columns[1] > 0 ? colName(columns[1]) : '',
        scope: 'spu',
        period: 'recent30',
        mode: 'overwrite-original-with-poizon-screen',
      });
    }

    // 수정 후 같은 워크북 내용을 다시 읽어 POIZON 기준값과 일치하는지 최종 검증한다.
    const verificationFailures = [];
    const rowCache = new Map();
    for (const target of verificationTargets) {
      let cached = rowCache.get(target.path);
      if (!cached) {
        const xml = strFromU8(archive[target.path]);
        const rows = new Map([...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map((m) => [Number(m[1]), m[0]]));
        cached = rows;
        rowCache.set(target.path, cached);
      }
      const rowXml = cached.get(target.row) || '';
      const actual = String(values(rowXml, shared)[target.column - 1] ?? '').trim();
      if (normalizedValue(actual) !== normalizedValue(target.expected)) {
        verificationFailures.push({ ...target, actual });
      } else {
        verifiedCells++;
      }
    }
    if (verificationFailures.length) {
      return {
        ok: false,
        code: 'EXCEL_POIZON_REVERIFY_FAILED',
        message: `POIZON 값으로 수정 후 ${verificationFailures.length}개 셀이 재검증에 실패했습니다. 원본 파일은 저장하지 않습니다.`,
        verificationFailures,
      };
    }
  } catch (error) {
    return { ok: false, code: 'EXCEL_SAFE_SYNC_REJECTED', message: error.message };
  }
  if (!productSheets) return { ok: false, code: 'EXCEL_PRODUCT_KEY_MISSING', message: '상품번호 또는 SPU ID 열을 찾지 못했습니다.' };
  return {
    ok: true,
    changed: changedRows > 0,
    matchedRows,
    changedRows,
    changedCells,
    missingCells,
    mismatchedCells,
    alreadyMatchedCells,
    verifiedCells,
    unresolvedRows,
    conflictedRows,
    comparisonMode: 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH',
    reverified: true,
    usedRecentColumns: true,
    usedDedicatedColumns: false,
    columnMappings,
    changes,
    buffer: changedRows ? Buffer.from(zipSync(archive, { level: 6 })) : Buffer.from(buffer),
  };
}
