import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const [renderer, main, html, workspace, session] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/poizon-review-workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../services/poizon-review-session.mjs", import.meta.url), "utf8"),
]);
const section = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Shipping source section missing: ${from}`);
  return source.slice(start, end);
};
const fileSync = () => section(renderer, '$("#import-button").addEventListener', '$("#export-button").addEventListener');

test("카테고리 검색은 인기리스트 대신 다운로드 완료 브랜드를 전달한다", () => {
  assert.match(renderer, /const favoriteBrandIds = \[\.\.\.categoryBrandIds\]/);
  assert.match(renderer, /const excelSales = await downloadedBrandSalesByArticle\(brand\)/);
  const category = section(renderer, '$("#category-search").addEventListener', 'async function showPoizonExcelVerificationPair');
  assert.doesNotMatch(category, /captureSellerBrandSales|syncExcelWithSellerScreen|queryExplorer|beginSellerExcelVerification/);
  assert.match(category, /const categoryProducts = excelSales\.products/);
  assert.match(renderer, /categorySelections\.some\(\(selection\) =>/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
});

test("다운로드 완료 브랜드 구성이 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, detail, minimumChinaSales30, minimumLocalSales30, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /:\$\{detail \|\| "all"\}:/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /category:local-excel-v8:/);
  assert.match(renderer, /다운로드 완료 브랜드가 없습니다/);
});

test("카테고리 필터는 저장된 Excel 최근 30일 값을 AND로 적용한다", () => {
  assert.match(renderer, /hasSalesData: screenProduct\.hasSalesData === true/);
  assert.match(renderer, /hasLocalSalesData: screenProduct\.hasLocalSalesData === true/);
  assert.match(renderer, /downloadedBrandSalesByArticle\(brand\)/);
  assert.match(renderer, /Number\(product\.sales30d \|\| 0\) >= minimumChinaSales30/);
  assert.match(renderer, /Number\(product\.localSales30d \|\| 0\) >= minimumLocalSales30/);
  assert.match(renderer, /salesSource: "local-excel"/);
  assert.match(renderer, /const minimumChinaSales30 = categorySalesMinimum/);
  assert.match(html, /id="category-min-china-sales-30"[^>]+value="100"/);
  assert.match(html, /id="category-min-local-sales-30"[^>]+value="30"/);
  assert.doesNotMatch(html, /id="category-min-sales"/);
});

test("파일 동기화와 브랜드 불러오기는 로컬 전용이고 POIZON 대조는 명시적 실행으로 분리된다", () => {
  assert.match(html, /id="import-button"[^>]*>다운로드 파일 동기화<\/button>/);
  assert.doesNotMatch(html, /id="brand-download-clear"/);
  const handler = fileSync();
  assert.match(handler, /await window\.aroundG\.listBrandExportFiles\(\)/);
  assert.match(handler, /renderDownloadedBrandFiles\(\)/);
  assert.doesNotMatch(handler, /captureSellerBrandSales|syncExcelWithSellerScreen|runPoizonReviewBatch|\.upsert\(|importExcel\(|\.click\(/);
  const localBrand = section(renderer, 'async function openReviewLocalBrandPreview', 'async function openVerifiedCombinedBrandPreview');
  assert.match(localBrand, /loadReviewSnapshots\(/);
  assert.doesNotMatch(localBrand, /captureSellerBrandSales|syncExcelWithSellerScreen|runPoizonReviewBatch|\.click\(/);
  const explicit = section(renderer, 'async function openVerifiedCombinedBrandPreview', 'async function openCombinedSelectedBrandPreview');
  assert.match(explicit, /runPoizonReviewBatch\(/);
  assert.match(renderer, /openCombinedSelectedBrandPreview\(files, \{ minimumTotal: "100", minimumLocalTotal: "25" \}\)/);
  assert.doesNotMatch(explicit, /openReviewLocalBrandPreview/);
  assert.match(renderer, /poizon-review-brand-start/);
  assert.match(renderer, /poizon-review-files-start/);
  // Explicit POIZON review only: full snapshot -> capture -> coverage -> unchanged check -> Excel correction -> reread -> report.
  const read = session.indexOf('const snapshots = await loadReviewSnapshots');
  const capture = session.indexOf('await api.captureSellerBrandSales', read);
  const coverage = session.indexOf('reviewCoverage(view.events(), captured)', capture);
  const revision = session.indexOf('await api.checkPoizonReviewWorkbook', coverage);
  const correction = session.indexOf('await api.syncExcelWithSellerScreen', revision);
  const reread = session.indexOf('await api.readPoizonReviewWorkbook', correction);
  const report = session.indexOf('buildReviewReport(snapshot, coverage.rows)', reread);
  const notify = session.indexOf('await notify(report, lastView)', report);
  assert.ok(read >= 0 && capture > read && coverage > capture && revision > coverage && correction > revision && reread > correction && report > reread && notify > report);
  assert.doesNotMatch(session, /\.upsert\(|writeFile\(/);
});

test("다운로드 동기화는 수동 POIZON 작업 복구 진행률과 분리한다", () => {
  assert.match(html, /POIZON 데이터 플랫폼 화면 값<\/b>을 우선 적용/);
  assert.match(main, /async function listBrandExportFiles\(\{ emitRecoveryProgress = false \} = \{\}\)/);
  assert.match(main, /if \(!emitRecoveryProgress\) return;/);
  assert.match(main, /emitRecoveryProgress: options\?\.recoveryProgress === true/);
  assert.doesNotMatch(fileSync(), /recoveryProgress:\s*true/);
  assert.match(renderer, /recoverInterruptedBrandWorkOnDemand[\s\S]*restoreDownloadedBrandFiles\(\{ recoveryProgress: true \}\)/);
});

test("파일 목록 진행 문구와 전용 대조 화면의 브랜드·페이지·상품 수 표시는 서로 독립적이다", () => {
  const handler = fileSync();
  assert.match(handler, /파일 목록 확인 중/);
  assert.match(handler, /POIZON 대조는 실행하지 않았습니다/);
  assert.match(handler, /finally[\s\S]*downloadFileSyncActive = false/);
  assert.match(handler, /button\.textContent = previous/);
  assert.match(workspace, /if \(stopped \|\| event\.runId !== runId\) return/);
  assert.match(workspace, /currentRows = \(event\.rows \|\| \[\]\)\.map/);
  assert.match(workspace, /get\('\.review-file'\)\.textContent/);
  const literal = workspace.match(/get\('\.review-phase'\)\.textContent = (`POIZON \$\{event\.pageNum\}[^\n]+`);/)?.[1];
  assert.ok(literal, "The dedicated view must render actual page comparison events");
  const rendered = new Function('event', 'currentRows', 'return ' + literal + ';')({ pageNum: 37, pageCount: 150 }, Array(20));
  assert.equal(rendered, 'POIZON 37/150페이지 · 상품 20/20 실시간 검색·대조 중');
  assert.match(workspace, /state\.checkedProducts/);
  assert.match(workspace, /state\.equalProducts/);
  assert.match(workspace, /state\.differentProducts/);
  assert.match(workspace, /판매량 수정 완료/);
  assert.match(workspace, /수정 대기/);
  assert.match(workspace, /state\.missingProducts/);
});

test("실제 교차 검증 문구는 두 창의 페이지·파일명과 브랜드·상품 수를 렌더링한다", () => {
  const literals = [
    renderer.match(/loading\.querySelector\("span"\)\.textContent = (`전체 \$\{percent\}% · 왼쪽 POIZON[^\n]+`);/)?.[1],
    renderer.match(/loading\.title = (`\$\{brandName\} 교차 검증 중 · POIZON[^\n]+`);/)?.[1],
    renderer.match(/status\.textContent = (`\$\{brandName\} 교차 검증 중 · 왼쪽 POIZON[^\n]+`);/)?.[1],
  ];
  assert.ok(literals.every(Boolean), "all three shipping cross-check messages must exist");
  const render = (literal, pages = 150) => new Function(
    "percent", "brandName", "page", "pages", "progress", "fileName", "return " + literal + ";",
  )(47, "코오롱스포츠", 37, pages, { count: 2843 }, "kolon.xlsx");
  assert.equal(render(literals[0]), "전체 47% · 왼쪽 POIZON 37/150페이지 · 오른쪽 Excel kolon.xlsx");
  assert.equal(render(literals[1]), "코오롱스포츠 교차 검증 중 · POIZON 37/150페이지 · 2,843개 상품 · Excel kolon.xlsx");
  assert.equal(render(literals[2]), "코오롱스포츠 교차 검증 중 · 왼쪽 POIZON 37/150페이지 · 오른쪽 Excel kolon.xlsx");
  assert.match(render(literals[0], 0), /37\/\?페이지/);
});

async function setup({ response, reviewRunning = false, active = false } = {}) {
  const source = fileSync();
  const moduleLine = 'const live = await import("./poizon-review-workspace.js");';
  assert.equal(source.split(moduleLine).length, 2, "Only replace the real module loader in the VM fixture");
  assert.match(source, /listBrandExportFiles\(/);
  assert.doesNotMatch(source, /captureSellerBrandSales|syncExcelWithSellerScreen|\.upsert\(|completedDownloadBrands\(|\.click\(/);
  const calls = { lists: 0, renders: 0, filters: [], forbidden: [], errors: [] };
  const saved = new Map(), nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      const item = { disabled: false, value: "", textContent: "", addEventListener(_event, handler) { this.handler = handler; } };
      nodes.set(selector, item);
    }
    return nodes.get(selector);
  };
  node("#import-button").textContent = "다운로드 파일 동기화";
  node("#brand-filter").value = "데상트";
  const previousFiles = [{ path: "C:/previous.xlsx", name: "previous.xlsx" }];
  const api = new Proxy({
    async listBrandExportFiles() {
      calls.lists++;
      assert.equal(node("#import-button").disabled, true);
      assert.equal(sandbox.downloadFileSyncActive, true);
      return typeof response === "function" ? response() : response ?? { ok: true, files: [] };
    },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return () => { calls.forbidden.push(String(key)); throw new Error("Unexpected API call: " + String(key)); };
    },
  });
  const sandbox = {
    $: node, window: { aroundG: api },
    reviewModule: { reviewIsRunning: () => reviewRunning },
    downloadFileSyncActive: active, downloadedBrandFiles: previousFiles,
    localStorage: { setItem: (key, value) => saved.set(key, value) },
    renderDownloadedBrandFiles: () => { calls.renders++; },
    renderBrandCards: (filter) => { calls.filters.push(filter); },
    showRuntimeError: (error) => { calls.errors.push(String(error.message || error)); },
  };
  // Keep the production event handler intact; only bridge the browser module import.
  runInNewContext(source.replace(moduleLine, "const live = await Promise.resolve(reviewModule);"), sandbox);
  return { sandbox, calls, saved, node, previousFiles, click: () => node("#import-button").handler() };
}

function assertReleased(h) {
  assert.equal(h.sandbox.downloadFileSyncActive, false);
  assert.equal(h.node("#import-button").disabled, false);
  assert.equal(h.node("#import-button").textContent, "다운로드 파일 동기화");
  assert.deepEqual(h.calls.forbidden, []);
}

test("download file sync only refreshes local files and never starts POIZON capture or workbook writes", async () => {
  const files = [{ path: "C:/a.xlsx", name: "a.xlsx" }, { path: "C:/b.xlsx", name: "b.xlsx" }];
  const h = await setup({ response: { ok: true, files } });
  await h.click();
  assert.equal(h.calls.lists, 1);
  assert.equal(h.sandbox.downloadedBrandFiles, files);
  assert.deepEqual(JSON.parse(h.saved.get("around-g-brand-download-files")), files);
  assert.equal(h.calls.renders, 1);
  assert.deepEqual(h.calls.filters, ["데상트"]);
  assert.deepEqual(h.calls.errors, []);
  assert.match(h.node("#excel-files-status").textContent, /2개 · POIZON 대조는 실행하지 않았습니다/);
  assertReleased(h);
});

test("failed or rejected file-list reads preserve the previous list and restore the button", async () => {
  for (const response of [
    { ok: false, message: "폴더 읽기 실패" },
    () => { throw new Error("폴더 읽기 실패"); },
  ]) {
    const h = await setup({ response });
    await h.click();
    assert.equal(h.sandbox.downloadedBrandFiles, h.previousFiles);
    assert.equal(h.saved.size, 0);
    assert.equal(h.calls.renders, 0);
    assert.deepEqual(h.calls.errors, ["폴더 읽기 실패"]);
    assert.doesNotMatch(h.node("#excel-files-status").textContent, /완료/);
    assertReleased(h);
  }
});

test("an in-flight file-list synchronization cannot start a second synchronization", async () => {
  let resolveList;
  const pending = new Promise((resolve) => { resolveList = resolve; });
  const h = await setup({ response: () => pending });
  const first = h.click();
  await Promise.resolve();
  assert.equal(h.calls.lists, 1);
  assert.equal(h.sandbox.downloadFileSyncActive, true);
  await h.click();
  assert.equal(h.calls.lists, 1);
  resolveList({ ok: true, files: [] });
  await first;
  assertReleased(h);
});

test("file sync is blocked by an active review or existing file-sync operation", async () => {
  for (const options of [{ reviewRunning: true }, { active: true }]) {
    const h = await setup(options);
    await h.click();
    assert.equal(h.calls.lists, 0);
    assert.equal(h.calls.renders, 0);
    assert.equal(h.saved.size, 0);
    assert.equal(h.sandbox.downloadedBrandFiles, h.previousFiles);
    assert.deepEqual(h.calls.forbidden, []);
    assert.deepEqual(h.calls.errors, []);
  }
});

test("a confirmed empty local file list is displayed as zero without creating a review", async () => {
  const h = await setup({ response: { ok: true, files: [] } });
  await h.click();
  assert.equal(h.sandbox.downloadedBrandFiles.length, 0);
  assert.equal(h.saved.get("around-g-brand-download-files"), "[]");
  assert.match(h.node("#excel-files-status").textContent, /0개 · POIZON 대조는 실행하지 않았습니다/);
  assertReleased(h);
});
