import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };

let live = await read('services/live-poizon-crosscheck.mjs');
if (!live.includes('POIZON_COMPOUND_RECENT30_NOT_MISSING')) {
  const start = live.indexOf('export function resolveExcelRecentMetric');
  const end = live.indexOf('\nconst article =', start);
  if (start < 0 || end < 0) throw new Error('fake-missing patch target missing: resolveExcelRecentMetric');
  const replacement = `// POIZON_COMPOUND_RECENT30_NOT_MISSING\nfunction compoundRecentMetric(rawValue) {\n  const raw = String(rawValue ?? '').normalize('NFKC').trim();\n  if (!raw.includes('/')) return null;\n  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);\n  if (parts.length < 2) return null;\n  const metrics = parts.map(metricFromRaw);\n  if (metrics.some((metric) => !metric)) return null;\n  const min = metrics.reduce((sum, metric) => sum + metric.min, 0);\n  const max = metrics.some((metric) => metric.max === Infinity) ? Infinity : metrics.reduce((sum, metric) => sum + metric.max, 0);\n  return { raw, min, max, signature: \`AGG:\${min}:\${max}\`, aggregate: true, componentCount: metrics.length };\n}\n\nfunction metricCompatible(excelEntry, sourceMetric) {\n  if (!excelEntry?.metric || !sourceMetric) return false;\n  if (excelEntry.state === 'resolved') return excelEntry.metric.signature === sourceMetric.signature;\n  if (excelEntry.state !== 'aggregate') return false;\n  const aggregate = excelEntry.metric;\n  const lowerOk = aggregate.min >= sourceMetric.min;\n  const upperOk = sourceMetric.max === Infinity || (aggregate.max !== Infinity && aggregate.max <= sourceMetric.max);\n  return lowerOk && upperOk;\n}\n\nexport function resolveExcelRecentMetric(products = [], local = false) {\n  const observed = products.map((product) => recentMetric(product, local)).filter(Boolean);\n  const bySignature = new Map();\n  for (const metric of observed) {\n    if (!bySignature.has(metric.signature)) bySignature.set(metric.signature, metric);\n  }\n  const totalValues = [...new Map(products.map((product) => totalMetric(product, local)).filter(Boolean).map((metric) => [metric.signature, metric])).values()];\n  const key = local ? 'localSales30d' : 'sales30d';\n  const rawRecentValues = [...new Set(products.map((product) => String(product?.[key + 'Raw'] ?? '').trim()).filter(Boolean))];\n\n  if (bySignature.size === 0 && rawRecentValues.length) {\n    const compounds = rawRecentValues.map(compoundRecentMetric).filter(Boolean);\n    if (compounds.length === rawRecentValues.length) {\n      const min = compounds.reduce((sum, metric) => sum + metric.min, 0);\n      const max = compounds.some((metric) => metric.max === Infinity) ? Infinity : compounds.reduce((sum, metric) => sum + metric.max, 0);\n      const componentCount = compounds.reduce((sum, metric) => sum + metric.componentCount, 0);\n      const metric = { raw: rawRecentValues.join(' / '), min, max, signature: \`AGG:\${min}:\${max}\`, aggregate: true, componentCount };\n      const range = max === Infinity ? \`\${min}+\` : min === max ? String(min) : \`\${min}~\${max}\`;\n      return { state: 'aggregate', metric, metrics: compounds, raw: \`옵션값 \${metric.raw} · 합계범위 \${range}\`,\n        diagnostic: \`최근30일 옵션값 \${componentCount}개를 합계범위로 판독 · 실제 누락 아님\` };\n    }\n  }\n  if (bySignature.size === 0) {\n    const diagnostic = rawRecentValues.length\n      ? \`최근30일 원본값 \${rawRecentValues.join(' / ')} · 파싱/가용성 확인 필요\`\n      : totalValues.length\n        ? \`최근30일 값 없음 · 총판매 \${totalValues.map((metric) => metric.raw).join(' / ')}\`\n        : '최근30일 값 없음';\n    return { state: 'missing', metric: null, metrics: [], raw: \`값 없음 · \${diagnostic}\`, diagnostic };\n  }\n  if (bySignature.size > 1) {\n    const metrics = [...bySignature.values()];\n    const diagnostic = \`최근30일 복수값 \${metrics.map((metric) => metric.raw).join(' / ')}\`;\n    return { state: 'conflict', metric: null, metrics, raw: metrics.map((metric) => metric.raw).join(' / '), diagnostic };\n  }\n  const metric = [...bySignature.values()][0];\n  return { state: 'resolved', metric, metrics: [metric], raw: metric.raw, diagnostic: '' };\n}\n`;
  live = live.slice(0, start) + replacement + live.slice(end);

  live = live.replace(
    "    const excelAvailable = excelResolved.every((entry) => entry.state === 'resolved' && entry.metric);",
    "    const excelAvailable = excelResolved.every((entry) => ['resolved', 'aggregate'].includes(entry.state) && entry.metric);"
  );
  live = live.replace(
    "    const equal = candidates.length > 0 && allAvailable\n      && excelResolved.every((entry, index) => entry.metric.signature === source[index].signature);",
    "    const equal = candidates.length > 0 && allAvailable\n      && excelResolved.every((entry, index) => metricCompatible(entry, source[index]));\n    const aggregateOnly = excelResolved.some((entry) => entry.state === 'aggregate');"
  );
  live = live.replace('    const status = !identity(product)', '    let status = !identity(product)');
  const statusEnd = "      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';";
  const legacyStatusEnd = "      : '값 다름 · POIZON 값으로 수정 대상';";
  const marker = live.includes(statusEnd) ? statusEnd : legacyStatusEnd;
  if (!live.includes(marker)) throw new Error('fake-missing patch target missing: status');
  live = live.replace(marker, marker + `\n    if (candidates.length && sourceAvailable && aggregateOnly) {\n      status = equal\n        ? '상품 인식 완료 · 옵션 합계 기준 판매량 일치 · 실제 누락 아님'\n        : '상품 인식 완료 · 옵션 합계 판독 · 실제 누락 아님 · 상품단위 값 재확인';\n    }`);
  live = live.replace(
    '      matched: candidates.length > 0, equal,',
    '      matched: candidates.length > 0, equal, autoCorrectionBlocked: aggregateOnly, compoundRecent30: aggregateOnly,'
  );
}
await save('services/live-poizon-crosscheck.mjs', live);

let main = await read('main.mjs');
if (!main.includes('POIZON_FAKE_MISSING_AUTOWRITE_GUARD')) {
  const before = '          products: currentPageProducts,\n          pageNum: capture.currentPage,';
  const after = `          // POIZON_FAKE_MISSING_AUTOWRITE_GUARD: slash-separated option values are not missing parent values.\n          products: currentPageProducts.filter((_, index) => !livePage.rows?.[index]?.autoCorrectionBlocked),\n          pageNum: capture.currentPage,`;
  if (!main.includes(before)) throw new Error('fake-missing patch target missing: page checkpoint products');
  main = main.replace(before, after);
}
await save('main.mjs', main);

let review = await read('services/poizon-review-session.mjs');
if (!review.includes('POIZON_FAKE_MISSING_FINAL_GUARD')) {
  const before = "      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: captured.products || [] });";
  const after = "      // POIZON_FAKE_MISSING_FINAL_GUARD: do not overwrite option-list rows classified as compound recent30 evidence.\n      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: (captured.products || []).filter((_, index) => !coverage.rows?.[index]?.autoCorrectionBlocked) });";
  if (!review.includes(before)) throw new Error('fake-missing patch target missing: final sync');
  review = review.replace(before, after);
}
await save('services/poizon-review-session.mjs', review);

console.log('POIZON fake missing fixed: slash-separated recent30 option values are parsed as aggregate evidence, never reported as missing, and never auto-overwritten as parent values.');
