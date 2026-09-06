import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = async (p) => (await readFile(new URL(p, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (p, s) => { if (s !== await read(p)) await writeFile(new URL(p, root), s, 'utf8'); };
function once(s, a, b, name) { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error('Safe value patch target missing: ' + name); return s.replace(a, b); }
function section(s, a, b, replacement) { const start = s.indexOf(a), end = s.indexOf(b, start + a.length); if (start < 0 || end < 0) throw new Error('Safe value section missing: ' + a); return s.slice(0, start) + replacement + s.slice(end); }

let xlsx = await read('services/poizon-xlsx.mjs');
if (!xlsx.includes('const parentHeadersPresent =')) {
  xlsx = once(xlsx, 'export function findPoizonRecentSalesColumns(headers = []) {\n  const normalized = headers.map(normalizePoizonHeader);', `export function findPoizonRecentSalesColumns(headers = []) {
  const normalized = headers.map(normalizePoizonHeader);
  const parentHeaders = ['POIZON 상품 최근 30일 판매량', 'POIZON 상품 현지 판매자 최근 30일 판매량'].map(normalizePoizonHeader);
  const parentHeadersPresent = parentHeaders.some((h) => normalized.includes(h));
  if (parentHeadersPresent) {
    const exact = (h) => { const hits = normalized.map((v, i) => v === h ? i : -1).filter((i) => i >= 0); return hits.length === 1 ? hits[0] : -1; };
    return { china: exact(parentHeaders[0]), local: exact(parentHeaders[1]) };
  }`, 'parent column priority');
}
await save('services/poizon-xlsx.mjs', xlsx);

let live = await read('services/live-poizon-crosscheck.mjs');
if (!live.includes('indexProductIdentities')) {
  live = 'import { indexProductIdentities, resolveProductIdentity } from "./poizon-product-identity.mjs";\n' + live;
  live = once(live, 'export function recentMetric(product = {}, local = false) {', 'export function recentMetric(product = {}, local = false) {\n  if (product.salesScope === "sku" || product.metricScope === "sku") return null;', 'SKU scope guard');
  live = section(live, '  const bySpu = new Map(), byArticle = new Map(), compared = new Map();', '  let pageNum =', '  const productIndex = indexProductIdentities(excelProducts), compared = new Map();\n');
  live = section(live, '    let candidates = bySpu.get(spu(product)) || [];', '    const source =', '    const resolved = resolveProductIdentity(product, productIndex);\n    const candidates = resolved.products;\n    const matchBy = resolved.reason || resolved.matchBy;\n');
}
await save('services/live-poizon-crosscheck.mjs', live);

let main = await read('main.mjs');
if (!main.includes('salesScope: headers.includes("POIZON 상품 최근 30일 판매량")')) {
  main = once(main, '      optionCount: 1,', '      optionCount: 1,\n      salesScope: headers.includes("POIZON 상품 최근 30일 판매량") || headers.includes("POIZON 상품 현지 판매자 최근 30일 판매량") ? "spu" : skuId ? "sku" : "spu",', 'reader metric scope');
}
if (!main.includes('const screenSyncFilesInProgress =')) {
  const start = main.indexOf('  ipcMain.handle("excel:sync-seller-screen",');
  const end = main.indexOf('  ipcMain.handle(', start + 30);
  if (start < 0 || end < 0) throw new Error('Workbook sync handler missing');
  main = main.slice(0, start) + `  const screenSyncFilesInProgress = new Set();
  ipcMain.handle("excel:sync-seller-screen", async (_event, input = {}) => {
    const filePath = String(input?.path || "").trim();
    if (!filePath || !/\\.xlsx$/i.test(filePath)) return { ok: false, message: "수정할 원본 Excel 경로가 올바르지 않습니다." };
    const lock = resolve(filePath).toLowerCase();
    if (screenSyncFilesInProgress.has(lock)) return { ok: false, message: "동일 Excel 파일을 저장 중입니다." };
    screenSyncFilesInProgress.add(lock);
    let temporary = "";
    try {
      const original = await readFile(filePath);
      const products = Array.isArray(input.products) ? input.products : [];
      const applied = applyPoizonScreenSalesToWorkbook(original, products);
      const { buffer, ...summary } = applied;
      if (!applied.ok || !applied.changed) return { ...summary, path: filePath };
      const stamp = new Date().toISOString().replace(/[-:.]/g, "") + "-" + Math.random().toString(36).slice(2);
      const backupPath = \`\${filePath}.before-poizon-screen-sync-\${stamp}.bak\`;
      temporary = \`\${filePath}.poizon-\${stamp}.tmp\`;
      await writeFile(temporary, buffer, { flag: "wx" });
      const persisted = await readFile(temporary);
      if (!persisted.equals(buffer)) throw new Error("임시 Excel 저장 내용이 일치하지 않습니다.");
      await readFirstDataSheet(persisted);
      const checked = applyPoizonScreenSalesToWorkbook(persisted, products);
      if (!checked.ok || checked.changed || checked.matchedRows !== applied.matchedRows) throw new Error("저장 후 판매량 재검증에 실패했습니다.");
      if (!(await readFile(filePath)).equals(original)) throw new Error("검증 도중 원본 Excel이 변경되어 덮어쓰지 않았습니다.");
      await writeFile(backupPath, original, { flag: "wx" });
      await writeFile(backupPath + ".json", JSON.stringify({ verifiedAt: new Date().toISOString(), scope: "SPU recent30", ...summary }, null, 2), { flag: "wx" });
      await rename(temporary, filePath);
      temporary = "";
      excelPreviewCache.clear();
      const info = await stat(filePath);
      return { ...summary, path: filePath, backupPath, auditPath: backupPath + ".json", fileSize: info.size, fileTime: info.mtimeMs };
    } catch (error) {
      return { ok: false, code: "EXCEL_SAFE_SYNC_FAILED", message: error.message };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      screenSyncFilesInProgress.delete(lock);
    }
  });
` + main.slice(end);
}
await save('main.mjs', main);

let renderer = await read('src/renderer.js');
if (!renderer.includes('async function openVerifiedCombinedBrandPreview')) {
  const helper = `
function renderVerifiedSpuRows(file, products) {
  const keys = products.map((p) => excelPreviewStableSelectionKey(p, file));
  products.forEach((p, i) => excelPreviewProductCache.set(keys[i], p));
  $("#excel-preview-columns").innerHTML = '<tr><th>선택</th><th>이미지</th><th>상품번호 · SPU</th><th>상품명 · 사이즈 펼치기</th><th>브랜드</th><th>상품 최근 30일 평균 거래가</th><th>중국 상품 최근 30일</th><th>현지 상품 최근 30일</th><th>검증</th><th>상품 검색 결과</th></tr>';
  $("#excel-preview-rows").innerHTML = products.length ? products.map((p, i) => {
    const options = (p.verificationOptions || []).map((o) => '<div><b>' + text(o.option || o.skuId || '옵션 미확인') + '</b> · SKU ' + text(o.skuId || '-') + ' · 원본 중국 총판매 ' + text(o.totalSalesRaw || '-') + ' · 원본 현지 총판매 ' + text(o.localTotalSalesRaw || '-') + '</div>').join('');
    const image = /^https?:\\/\\//.test(p.logoUrl || '') ? '<img style="width:40px;height:40px;object-fit:contain" src="' + text(p.logoUrl) + '" alt="">' : '';
    return '<tr><td><input type="checkbox" data-excel-product-select="' + encodeURIComponent(keys[i]) + '"></td><td>' + image + '</td><td><b>' + text(p.articleNumber) + '</b><small> SPU ' + text(p.spuId) + '</small></td><td>' + text(p.title) + '<details><summary>원본 사이즈 ' + p.optionCount + '행</summary>' + options + '</details></td><td>' + text(p.brandName) + '</td><td>' + (p.hasPriceData ? money(p.averagePrice) : '미확인') + '</td><td>' + text(p.hasSalesData ? p.sales30dRaw : '미확인') + '</td><td>' + text(p.hasLocalSalesData ? p.localSales30dRaw : '미확인') + '</td><td>' + text(p.verificationStatus) + '</td>' + renderRawExcelDomesticCell(keys[i], p, excelPreviewSearchResults.get(keys[i])) + '</tr>';
  }).join('') : '<tr><td colspan="10">동일 조건에 맞는 검증 완료 상품이 없습니다. 실패·누락 집계도 확인해 주세요.</td></tr>';
  return keys;
}

async function openVerifiedCombinedBrandPreview(files, filters) {
  const module = await import("../services/verified-combined-search.mjs");
  const liveModule = await import("./live-poizon-crosscheck.js");
  const defaults = liveModule.readVerificationConditions();
  const conditions = { minimumChinaSales30: filters.minimumTotal ?? defaults.minimumChinaSales30,
    minimumLocalSales30: filters.minimumLocalTotal ?? defaults.minimumLocalSales30 };
  const status = $("#brand-status");
  const loading = $("#completed-brand-domestic-search");
  if (loading) loading.disabled = true;
  try {
    const result = await module.runVerifiedCombinedSearch({ files, conditions, api: window.aroundG,
      openVerification: (file, products, snapshot) => prepareLivePoizonVerification(file, file.brandName || file.name, products, snapshot),
      onProgress: (event) => { if (status) status.textContent = (event.index + 1) + '/' + event.total + ' · ' + (event.file.brandName || event.file.name) + ' · ' + (event.message || (event.phase === 'reading' ? '원본 전체 읽기' : '실제 화면 대조')); },
    });
    combinedBrandPreview = { ...result, filters: { minimumTotal: result.conditions.minimumChinaSales30 ?? '', minimumLocalTotal: result.conditions.minimumLocalSales30 ?? '' } };
    if (files[0]) await openIntegratedBrandExcel(files[0], false);
    $("#excel-preview").classList.remove('poizon-live-mode');
    $("#poizon-live-check")?.remove();
    selectedExcelPreviewProducts.clear(); excelPreviewProductCache.clear(); excelPreviewSearchResults.clear();
    excelPreviewIntegrated = true;
    renderCombinedBrandPreviewPage(0);
  } finally {
    await window.aroundG.endSellerExcelVerification?.().catch(() => {});
    if (loading) loading.disabled = false;
  }
}

`;
  renderer = once(renderer, 'async function openCombinedSelectedBrandPreview(files = [], filters = {}) {', helper + 'async function openCombinedSelectedBrandPreview(files = [], filters = {}) {\n  return openVerifiedCombinedBrandPreview(files, filters);', 'integrated verified entry');
  renderer = once(renderer, '  excelPreviewPageKeys = renderExcelProductRows(file, products);', '  excelPreviewPageKeys = combinedBrandPreview.verified ? renderVerifiedSpuRows(file, products) : renderExcelProductRows(file, products);', 'SPU result rendering');
  const start = renderer.indexOf('function renderCombinedBrandPreviewPage('), end = renderer.indexOf('function renderVerifiedSpuRows(', start);
  let part = renderer.slice(start, end);
  const tail = '  updateExcelPreviewSelectionUi(excelPreviewPageKeys);\n}';
  part = once(part, tail, `  if (combinedBrandPreview.verified) {
    const failures = combinedBrandPreview.failures || [], audits = combinedBrandPreview.audits || [];
    const missing = audits.reduce((sum, a) => sum + a.excelNotFoundProducts, 0);
    const absent = audits.reduce((sum, a) => sum + a.sourceNotFoundRows, 0);
    const message = '최근 30일 · SPU 상품 단위 · 중국 ' + (minimumTotal || '조건 없음') + ' / 현지 ' + (minimumLocalTotal || '조건 없음') + ' · ' + totalRows + '상품 · Excel에서 찾지 못함 ' + missing + '상품 · POIZON에서 찾지 못함 ' + absent + '원본행 · 실패 ' + failures.length + '브랜드';
    $("#excel-preview-summary").textContent = message;
    $("#brand-product-workspace-meta").textContent = message;
    $("#excel-filter-status").textContent = failures.length ? failures.map((f) => f.file + ': ' + f.message).join(' / ') : '원본 총판매량·사이즈 값 보존 · 검증된 상품 최근 30일 값으로 필터 적용';
    const labels = [$("#excel-filter-min-total")?.closest('label')?.querySelector('span'), $("#excel-filter-min-local-total")?.closest('label')?.querySelector('span')];
    if (labels[0]) labels[0].textContent = '중국 상품 최근 30일 최소';
    if (labels[1]) labels[1].textContent = '현지 판매자 상품 최근 30일 최소';
  }
  updateExcelPreviewSelectionUi(excelPreviewPageKeys);
}`, 'visible accurate counts');
  renderer = renderer.slice(0, start) + part + renderer.slice(end);
  // Restore raw-view labels: these remain original lifetime columns.
  renderer = once(renderer, 'async function showExcelPreview(file, offset = 0, filters = currentExcelPreviewFilters(), options = {}) {', `async function showExcelPreview(file, offset = 0, filters = currentExcelPreviewFilters(), options = {}) {
  const rawLabels = [$("#excel-filter-min-total")?.closest('label')?.querySelector('span'), $("#excel-filter-min-local-total")?.closest('label')?.querySelector('span')];
  if (rawLabels[0]) rawLabels[0].textContent = '중국 총 판매량 (원본)';
  if (rawLabels[1]) rawLabels[1].textContent = '현지 판매자 총 판매량 (원본)';`, 'raw label separation');
}
await save('src/renderer.js', renderer);
console.log('Safe value integrity applied: common identity, dedicated SPU recent columns, atomic backup/reread and verified combined search.');
