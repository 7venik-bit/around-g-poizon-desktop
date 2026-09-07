import { indexProductIdentities, resolveProductIdentity, consistentParentProduct, productSpu, normalizedArticle, verifiedParentMetric } from './poizon-product-identity.mjs';
import { normalizeVerificationConditions, meetsVerificationConditions, recentMetric } from './live-poizon-crosscheck.mjs';

export async function readAllVerificationProducts(api, file) {
  const products = []; let offset = 0;
  while (true) {
    // Deliberately unfiltered: old Excel=10 must not hide current POIZON=83.
    const result = await api.previewExcelFile(file.path, offset, 100000, {
      minimumTotal: '', minimumLocalTotal: '', productView: true, selectionOnly: true,
    });
    if (!result?.ok || !Array.isArray(result.products)) throw new Error(result?.message || 'Excel 전체 읽기 실패');
    const total = Number(result.totalRows);
    if (!Number.isFinite(total) || total < 0 || Number(result.offset) !== offset) throw new Error('Excel 페이지 범위가 일치하지 않습니다.');
    products.push(...result.products); offset += result.products.length;
    if (offset === total) break;
    if (!result.products.length || offset > total) throw new Error('Excel 행 누락을 발견했습니다.');
  }
  return products;
}

function sourceGroups(screen) {
  const groups = new Map();
  for (const p of screen) {
    const key = productSpu(p) ? `SPU:${productSpu(p)}` : `ARTICLE:${normalizedArticle(p.articleNumber)}`;
    if (key === 'ARTICLE:') throw new Error('POIZON 상품 식별자가 없습니다.');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups].map(([key, candidates]) => {
    const product = consistentParentProduct(candidates);
    if (!product) throw new Error(`동일 상품의 POIZON 값이 충돌합니다: ${key}`);
    return { key, product };
  });
}

const persistedRecentMetric = (product, local = false) => recentMetric({
  ...product,
  salesScope: 'spu',
  metricScope: 'spu',
}, local);

export function checkPersistedParentMetrics(screen, before, after) {
  const beforeIndex = indexProductIdentities(before), afterIndex = indexProductIdentities(after);
  const failures = [];
  for (const { key, product } of sourceGroups(screen)) {
    const expected = resolveProductIdentity(product, beforeIndex);
    if (!expected.products.length) continue; // Missing source rows are reported, not invented.
    const saved = resolveProductIdentity(product, afterIndex);
    if (saved.products.length !== expected.products.length) { failures.push(key); continue; }
    for (const local of [false, true]) {
      if (verifiedParentMetric(product, local) === null) continue;
      const metric = recentMetric(product, local);
      // The persisted workbook can contain size/SKU rows. For the final write
      // verification we compare the actual corrected cell value itself instead
      // of suppressing it because the row is SKU-scoped.
      if (saved.products.some((p) => persistedRecentMetric(p, local)?.signature !== metric?.signature)) {
        failures.push(key);
        break;
      }
    }
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export function groupedVerifiedProducts(screen, before, after, conditions, file) {
  const index = indexProductIdentities(before);
  return sourceGroups(screen).map(({ key, product }) => {
    const match = resolveProductIdentity(product, index);
    const options = match.products.map((p) => ({ ...p }));
    const exemplar = options[0] || {};
    return {
      ...exemplar, ...product, key, spuId: productSpu(product), skuId: '', option: '',
      title: exemplar.title || product.title || product.name || '',
      brandName: file.brandName || exemplar.brandName || product.brandName || '',
      averagePrice: product.hasPriceData === true ? Number(product.averagePrice || 0) : 0,
      hasPriceData: product.hasPriceData === true,
      salesScope: 'spu', screenVerified: true, salesSource: 'seller-center-screen',
      verificationOptions: options, optionCount: options.length,
      sourceRowNumbers: options.map((p) => p.sourceRowNumber).filter(Boolean),
      verificationStatus: options.length ? 'POIZON 값으로 수정 후 대조 완료' : match.reason === '상품 없음' ? 'Excel에서 찾지 못함' : match.reason,
      _sourceFilePath: file.path, _sourceBrandName: file.brandName || '',
      _excelSelectionKey: `${file.path.toLowerCase()}::${key}`,
    };
  }).filter((p) => meetsVerificationConditions(p, conditions));
}

// Dependencies are injected so the exact production sequence can be simulated.
export async function runVerifiedCombinedSearch({ files, conditions, api, openVerification, onProgress = () => {} }) {
  if (!Array.isArray(files) || !files.length) throw new Error('검증할 Excel 파일이 없습니다.');
  const frozen = normalizeVerificationConditions(conditions);
  const products = [], failures = [], audits = []; let loadedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]; let live;
    onProgress({ phase: 'reading', index: i, total: files.length, file });
    try {
      const before = await readAllVerificationProducts(api, file);
      live = await openVerification(file, before, frozen);
      const captured = await api.captureSellerBrandSales({ brandName: file.brandName || '', verification: live.input });
      if (!captured?.ok || !Array.isArray(captured.products)) throw new Error(captured?.message || 'POIZON 전체 페이지 검증 미완료');
      sourceGroups(captured.products); // Reject conflicting identities before any write.
      live.saving();
      const saved = await api.syncExcelWithSellerScreen({ path: file.path, products: captured.products });
      if (!saved?.ok) throw new Error(saved?.message || 'Excel 안전 저장 실패');
      const after = await readAllVerificationProducts(api, file);
      const reread = checkPersistedParentMetrics(captured.products, before, after);
      if (!reread.ok) throw new Error(`저장 후 값이 일치하지 않습니다: ${reread.failures.slice(0, 5).join(', ')}`);
      live.finish({ ok: true, changedRows: saved.changedRows, screenProducts: captured.products, afterProducts: after });
      const grouped = groupedVerifiedProducts(captured.products, before, after, frozen, file);
      products.push(...grouped); loadedCount++;
      const sourceIndex = indexProductIdentities(captured.products);
      audits.push({ file: file.name || file.path, sourceProducts: sourceGroups(captured.products).length,
        excelRows: before.length, qualifiedProducts: grouped.length, changedRows: saved.changedRows || 0,
        excelNotFoundProducts: sourceGroups(captured.products).filter(({ product }) => !resolveProductIdentity(product, indexProductIdentities(before)).products.length).length,
        sourceNotFoundRows: before.filter((p) => !resolveProductIdentity(p, sourceIndex).products.length).length });
      onProgress({ phase: 'complete', index: i, total: files.length, file, audit: audits.at(-1) });
    } catch (error) {
      live?.finish({ ok: false, message: error.message });
      failures.push({ file: file.name || file.path, message: error.message });
      onProgress({ phase: 'failed', index: i, total: files.length, file, message: error.message });
    } finally {
      if (live?.running) live.finish({ ok: false, message: '검증 종료 전 중단됨' });
    }
  }
  return { products, loadedCount, brandCount: files.length, files, conditions: frozen, failures, audits,
    verified: true, complete: failures.length === 0 };
}
