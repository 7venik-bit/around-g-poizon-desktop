import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFirstDataSheet } from './excel-reader.mjs';
import { findPoizonRecentSalesColumns, normalizePoizonHeader } from './poizon-xlsx.mjs';

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const pathOf = (input) => {
  const path = String(input?.path || '').trim();
  if (!path || !/\.xlsx$/i.test(path)) throw new Error('검증할 Excel(.xlsx) 경로가 올바르지 않습니다.');
  return path;
};

// Preserve each original row. Evidence is captured BEFORE grouping or numeric parsing.
export function createReviewWorkbookSnapshot(rows, buildProducts, revision = '') {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) throw new Error('Excel 헤더를 읽지 못했습니다.');
  const headers = rows[0].map((v) => String(v ?? ''));
  const columns = findPoizonRecentSalesColumns(headers);
  const normalized = headers.map(normalizePoizonHeader);
  const isParent = (h) => /상품.*최근30일.*판매량/.test(h) && !/sku|사이즈|옵션/.test(h);
  const parentColumns = {};
  for (const side of ['china', 'local']) {
    const hits = normalized.map((h, i) => isParent(h) && /현지/.test(h) === (side === 'local') ? i : -1).filter((i) => i >= 0);
    parentColumns[side] = hits.length ? (hits.length === 1 ? hits[0] : -1) : columns[side];
  }
  const entries = rows.slice(1).map((values, i) => ({ values, sourceRowNumber: i + 2 }));
  const parsed = buildProducts(headers, entries);
  const byRow = new Map(parsed.map((p) => [Number(p.sourceRowNumber), p]));
  const products = entries.map((entry) => {
    const p = byRow.get(entry.sourceRowNumber);
    const reviewMetricEvidence = {};
    for (const side of ['china', 'local']) {
      const columnIndex = parentColumns[side];
      const columnFound = Number.isInteger(columnIndex) && columnIndex >= 0 && columnIndex < headers.length;
      const columnName = columnFound ? headers[columnIndex] : '';
      const hasSku = Boolean(p?.skuId || p?.globalSkuId || p?.salesScope === 'sku' || p?.metricScope === 'sku');
      reviewMetricEvidence[side] = {
        columnFound, columnIndex: columnFound ? columnIndex : -1, columnName,
        scope: columnFound && isParent(normalized[columnIndex]) ? 'spu' : hasSku ? 'sku' : 'spu',
        raw: columnFound ? String(entry.values[columnIndex] ?? '') : '',
        sourceRowNumber: entry.sourceRowNumber,
      };
    }
    return { ...(p || { key: `UNREADABLE-ROW:${entry.sourceRowNumber}`, sourceRowNumber: entry.sourceRowNumber,
      articleNumber: '', spuId: '', skuId: '', title: '', hasSalesData: false, hasLocalSalesData: false }),
      sourceValues: entry.values.map((v) => v == null ? '' : v instanceof Date ? v.toISOString() : String(v)),
      reviewColumnNames: { china: reviewMetricEvidence.china.columnName, local: reviewMetricEvidence.local.columnName },
      reviewMetricEvidence,
      identityReadable: Boolean(p && (p.spuId || p.articleNumber)),
    };
  });
  return { ok: true, headers, products, sourceTotalRows: entries.length,
    identityReadableRows: products.filter((p) => p.identityReadable).length,
    unidentifiedRows: products.filter((p) => !p.identityReadable).map((p) => p.sourceRowNumber), revision };
}

export async function readReviewWorkbook(input, buildProducts) {
  try {
    const path = pathOf(input);
    const buffer = await readFile(path);
    const snapshot = createReviewWorkbookSnapshot(await readFirstDataSheet(buffer), buildProducts, digest(buffer));
    return { ...snapshot, path };
  } catch (error) { return { ok: false, message: error.message }; }
}

export async function checkReviewWorkbookRevision(input) {
  try {
    const path = pathOf(input);
    if (!/^[a-f\d]{64}$/.test(String(input.revision || ''))) throw new Error('Excel 원본 확인번호가 없습니다.');
    return { ok: true, unchanged: digest(await readFile(path)) === input.revision };
  } catch (error) { return { ok: false, unchanged: false, message: error.message }; }
}
