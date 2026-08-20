import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const [main, relay, renderer, preload, menu, css] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../src/search-service-menu.css", import.meta.url), "utf8"),
]);

test("국내 검색은 분리 모듈 없이 한 순차 흐름으로 실행한다", async () => {
  await assert.rejects(access(new URL("../services/domestic-search-modules/index.mjs", import.meta.url)));
  assert.doesNotMatch(relay, /buildDomesticSearchPlan|requestedModules|source\.module/);
  assert.match(relay, /const sources = \[/);
  assert.match(main, /for \(const source of data\.sources\)/);
  assert.doesNotMatch(main, /domestic-search:module-status/);
  assert.doesNotMatch(preload, /onDomesticModuleStatus/);
  assert.doesNotMatch(renderer, /domestic-module:retry|resetDomesticModuleLamps|moduleIds/);
  assert.doesNotMatch(menu, /domestic-module-lamps|data-module-lamp|onDomesticModuleStatus/);
  assert.doesNotMatch(css, /domestic-module-lamps|module-lamp/);
});

test("브랜드 검색부터 정렬·내보내기까지 분리 전 판매자센터 흐름을 사용한다", () => {
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /typeSellerBrandWithRealKeyboard\(candidate\.frame, sellerBrandSearchName\)/);
  assert.match(workflow, /runSellerSearch\(candidate\.frame, Boolean\(realKeyboardInput\?\.submitted\)\)/);
  assert.match(workflow, /performPhysicalSellerSortAndExport\(candidate\.frame\)/);
  assert.match(workflow, /confirmSellerExportRequestPhysical\(candidate\.frame\)/);
  assert.match(workflow, /clickSellerDownloadCenterShortcutPhysical\(candidate\.frame\)/);
  assert.doesNotMatch(workflow, /applyExactSellerBrandFilter\(candidate\.frame/);
});
