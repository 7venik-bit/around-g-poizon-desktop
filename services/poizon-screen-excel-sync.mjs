import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { findPoizonColumn, findPoizonRecentSalesColumns } from './poizon-xlsx.mjs';
import { indexProductIdentities, resolveProductIdentity, consistentParentProduct, verifiedParentMetric } from './poizon-product-identity.mjs';

const SHEET = /^xl\/worksheets\/sheet\d+\.xml$/;
const ROW = /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g;
const decode = (s = '') => String(s).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colNumber = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
const normalizeArticle = (value) => String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeSpu = (value) => String(value || '').trim();
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
function styleForColumn(rowXml, column) {
  const existing = cells(rowXml).find((m) => colNumber(m[1]) === column);
  return existing?.[0].match(/\bs="([^"]+)"/)?.[1] || '';
}
function inlineCell(column, rowNumber, value, templateRow = '') {
  if (column < 1 || value == null || String(value).trim() === '') return '';
  const style = styleForColumn(templateRow, column);
  return `<c r="${colName(column)}${rowNumber}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${escape(String(value).trim())}</t></is></c>`;
}
function appendRow(xml, rowXml) {
  if (!/<\/sheetData>/.test(xml)) throw new Error('Excel sheetData를 찾지 못해 누락 상품 행을 추가할 수 없습니다.');
  return xml.replace(/<\/sheetData>/, rowXml + '</sheetData>');
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
// 1) 기존 Excel 행의 최근 30일 값은 POIZON과 비교해 누락/불일치를 수정한다.
// 2) Excel에 상품 행 자체가 없으면 SPU가 확정되고 POIZON 판매량이 검증된 상품만 새 행으로 추가한다.
// 3) 수정/추가 뒤 실제 XLSX를 다시 읽어 모든 대상 셀이 일치해야만 성공으로 반환한다.
export function applyPoizonScreenSalesToWorkbook(buffer, screenProducts = []) {
  const archive = unzipSync(new Uint8Array(buffer));
  const paths = Object.keys(archive).filter((p) => SHEET.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!paths.length) return { ok: false, code: 'EXCEL_WORKSHEET_MISSING', message: 'Excel 워크시트를 찾지 못했습니다.' };
  const sharedXml = archive['xl/sharedStrings.xml'] ? strFromU8(archive['xl/sharedStrings.xml']) : '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const index = indexProductIdentities(screenProducts);
  let matchedRows = 0, changedRows = 0, changedCells = 0, unresolvedRows = 0, conflictedRows = 0, productSheets = 0;
  let missingCells = 0, mismatchedCells = 0, alreadyMatchedCells = 0, verifiedCells = 0;
  let addedRows = 0, addedCells = 0, addedProducts = 0, addedVerifiedRows = 0;
  let skippedMissingSpu = 0, skippedUnverifiedProducts = 0, skippedConflictedProducts = 0;
  const columnMappings = [], changes = [], verificationTargets = [], addedIdentityTargets = [];
  const metadata = [];
  const existingSpus = new Set();
  const existingArticles = new Map();

  try {
    // First pass: discover product sheets and all existing identities before writing anything.
    for (const path of paths) {
      const xml = strFromU8(archive[path]);
      const rows = [...xml.matchAll(ROW)];
      const header = rows.find((r) => Number(r[1]) === 1);
      if (!header) continue;
      const headers = values(header[0], shared);
      const spu = findPoizonColumn(headers, 'SPU ID', 'SPU_ID', 'SPUID');
      const article = findPoizonColumn(headers, '상품 번호', '상품번호', '상품코드', '품번');
      const brandId = findPoizonColumn(headers, '브랜드 ID', 'Brand ID');
      if (spu < 0 && article < 0) continue;
      const salesColumns = findPoizonRecentSalesColumns(headers);
      if (salesColumns.china < 0 && salesColumns.local < 0) {
        return { ok: false, code: 'EXCEL_RECENT_SALES_COLUMNS_MISSING', message: 'Excel에서 최근 30일 판매량 또는 POIZON 원본 판매량 열을 찾지 못했습니다.' };
      }
      productSheets++;
      const title = findPoizonColumn(headers, '상품명', '상품 이름', '상품제목', '상품 제목', '상품명(중문)', '제품명');
      const brand = findPoizonColumn(headers, '상품 브랜드', '브랜드', '브랜드명');
      const columns = [salesColumns.china >= 0 ? salesColumns.china + 1 : -1, salesColumns.local >= 0 ? salesColumns.local + 1 : -1];
      const lastDataRow = [...rows].reverse().find((r) => Number(r[1]) > 1)?.[0] || '';
      metadata.push({ path, xml, rows, headers, spu, article, brandId, title, brand, columns, lastDataRow });
      for (const row of rows) {
        const n = Number(row[1]); if (n <= 1) continue;
        const v = values(row[0], shared);
        const s = normalizeSpu(v[spu]);
        const a = normalizeArticle(v[article]);
        if (s) existingSpus.add(s);
        if (a) {
          if (!existingArticles.has(a)) existingArticles.set(a, new Set());
          if (s) existingArticles.get(a).add(s);
        }
      }
    }
    if (!productSheets) return { ok: false, code: 'EXCEL_PRODUCT_KEY_MISSING', message: '상품번호 또는 SPU ID 열을 찾지 못했습니다.' };

    // Existing-row correction.
    for (const meta of metadata) {
      const { path, xml, rows, spu, article, brandId, columns } = meta;
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
        if (data.some((item) => item !== null)) pending.set(n, data);
      }
      let updated = xml.replace(ROW, (rowXml, rowNumber) => {
        const n = Number(rowNumber), data = pending.get(n);
        if (!data || n <= 1) return rowXml;
        let next = rowXml;
        const oldValues = values(rowXml, shared);
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
          changes.push({ sheet: path, row: n, column: colName(column), field: fields[i], before, after,
            reason: before ? 'VALUE_MISMATCH' : 'MISSING_VALUE', result: 'POIZON_VALUE_APPLIED' });
          verificationTargets.push({ path, row: n, column, field: fields[i], expected: after });
        });
        if (rowChanged) changedRows++;
        return next;
      });
      if (updated !== xml) archive[path] = strToU8(fixDimension(updated));
      columnMappings.push({ sheet: path, china: columns[0] > 0 ? colName(columns[0]) : '', local: columns[1] > 0 ? colName(columns[1]) : '',
        scope: 'spu', period: 'recent30', mode: 'overwrite-original-with-poizon-screen-and-append-missing-spu' });
    }

    // Missing-product append. Only a confirmed SPU can create a new Excel row.
    const primary = metadata.find((m) => m.spu >= 0 && (m.columns[0] > 0 || m.columns[1] > 0));
    if (primary) {
      const bySpu = new Map();
      for (const product of screenProducts) {
        const s = normalizeSpu(product?.spuId || product?.globalSpuId);
        if (!s) { skippedMissingSpu++; continue; }
        if (!bySpu.has(s)) bySpu.set(s, []);
        bySpu.get(s).push(product);
      }
      let updated = strFromU8(archive[primary.path]);
      let nextRow = Math.max(1, ...[...updated.matchAll(ROW)].map((m) => Number(m[1]) || 1)) + 1;
      let templateRow = [...updated.matchAll(ROW)].reverse().find((m) => Number(m[1]) > 1)?.[0] || primary.lastDataRow;
      for (const [spuId, products] of bySpu) {
        if (existingSpus.has(spuId)) continue;
        const source = consistentParentProduct(products);
        if (!source) { skippedConflictedProducts++; continue; }
        const articles = [...new Set(products.map((p) => normalizeArticle(p?.articleNumber || p?.productCode)).filter(Boolean))];
        if (articles.length > 1) { skippedConflictedProducts++; continue; }
        const articleValue = String(source.articleNumber || source.productCode || '').trim();
        const articleKey = normalizeArticle(articleValue);
        if (articleKey && existingArticles.has(articleKey)) {
          const mappedSpus = existingArticles.get(articleKey);
          if (mappedSpus.size && !mappedSpus.has(spuId)) { skippedConflictedProducts++; continue; }
        }
        const china = verifiedParentMetric(source);
        const local = verifiedParentMetric(source, true);
        if (china === null && local === null) { skippedUnverifiedProducts++; continue; }

        const data = new Map();
        data.set(primary.spu + 1, spuId);
        if (primary.article >= 0 && articleValue) data.set(primary.article + 1, articleValue);
        if (primary.title >= 0) {
          const title = String(source.name || source.title || '').trim();
          if (title) data.set(primary.title + 1, title);
        }
        if (primary.brand >= 0) {
          const brand = String(source.brandName || source.brand || '').trim();
          if (brand) data.set(primary.brand + 1, brand);
        }
        if (primary.brandId >= 0) {
          const brandId = String(source.brandId || '').trim();
          if (brandId) data.set(primary.brandId + 1, brandId);
        }
        if (primary.columns[0] > 0 && china !== null) data.set(primary.columns[0], String(china));
        if (primary.columns[1] > 0 && local !== null) data.set(primary.columns[1], String(local));

        const ordered = [...data.entries()].sort((a, b) => a[0] - b[0]);
        const rowXml = `<row r="${nextRow}">${ordered.map(([column, value]) => inlineCell(column, nextRow, value, templateRow)).join('')}</row>`;
        updated = appendRow(updated, rowXml);
        addedRows++; addedProducts++; addedCells += ordered.length;
        changes.push({ sheet: primary.path, row: nextRow, field: '상품 행', before: '', after: articleValue || spuId,
          reason: 'MISSING_PRODUCT_ROW', result: 'POIZON_PRODUCT_ROW_ADDED', spuId, articleNumber: articleValue });
        addedIdentityTargets.push({ path: primary.path, row: nextRow, column: primary.spu + 1, expected: spuId });
        if (primary.columns[0] > 0 && china !== null) verificationTargets.push({ path: primary.path, row: nextRow, column: primary.columns[0], field: '중국 최근 30일 판매량', expected: String(china) });
        if (primary.columns[1] > 0 && local !== null) verificationTargets.push({ path: primary.path, row: nextRow, column: primary.columns[1], field: '현지 판매자 최근 30일 판매량', expected: String(local) });
        existingSpus.add(spuId);
        if (articleKey) {
          if (!existingArticles.has(articleKey)) existingArticles.set(articleKey, new Set());
          existingArticles.get(articleKey).add(spuId);
        }
        templateRow = rowXml;
        nextRow++;
      }
      if (addedRows) archive[primary.path] = strToU8(fixDimension(updated));
    }

    const verificationFailures = [];
    const rowCache = new Map();
    const getRow = (path, row) => {
      let cached = rowCache.get(path);
      if (!cached) {
        const xml = strFromU8(archive[path]);
        cached = new Map([...xml.matchAll(ROW)].map((m) => [Number(m[1]), m[0]]));
        rowCache.set(path, cached);
      }
      return cached.get(row) || '';
    };
    for (const target of verificationTargets) {
      const actual = String(values(getRow(target.path, target.row), shared)[target.column - 1] ?? '').trim();
      if (normalizedValue(actual) !== normalizedValue(target.expected)) verificationFailures.push({ ...target, actual });
      else verifiedCells++;
    }
    for (const target of addedIdentityTargets) {
      const actual = String(values(getRow(target.path, target.row), shared)[target.column - 1] ?? '').trim();
      if (normalizedValue(actual) !== normalizedValue(target.expected)) verificationFailures.push({ ...target, field: 'SPU ID', actual });
      else addedVerifiedRows++;
    }
    if (verificationFailures.length) {
      return { ok: false, code: 'EXCEL_POIZON_REVERIFY_FAILED',
        message: `POIZON 값으로 수정/추가 후 ${verificationFailures.length}개 항목이 재검증에 실패했습니다. 원본 파일은 저장하지 않습니다.`, verificationFailures };
    }
  } catch (error) {
    return { ok: false, code: 'EXCEL_SAFE_SYNC_REJECTED', message: error.message };
  }
  const changed = changedRows > 0 || addedRows > 0;
  return {
    ok: true, changed, matchedRows, changedRows, changedCells, missingCells, mismatchedCells, alreadyMatchedCells, verifiedCells,
    addedRows, addedCells, addedProducts, addedVerifiedRows, skippedMissingSpu, skippedUnverifiedProducts, skippedConflictedProducts,
    unresolvedRows, conflictedRows, comparisonMode: 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH', reverified: true,
    usedRecentColumns: true, usedDedicatedColumns: false, columnMappings, changes,
    buffer: changed ? Buffer.from(zipSync(archive, { level: 6 })) : Buffer.from(buffer),
  };
}
