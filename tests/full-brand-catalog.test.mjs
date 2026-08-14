import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, readFile as readFileFromDisk, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BRAND_CATALOG_MAX_AGE_MS,
  FULL_BRAND_CATALOG_MINIMUM,
  brandCatalogNeedsSync,
  salesRankedBrands,
  parseKrPoizonBrandData,
} from "../services/brand-catalog.mjs";

test("판매순위 상위 200건에서 연관 브랜드만 순서대로 추출한다", () => {
  const brands = [
    { id: 144, name: "Nike", ko: "나이키" },
    { id: 3, name: "Adidas", ko: "아디다스" },
    { id: 4, name: "New Balance", ko: "뉴발란스" },
  ];
  const ranked = salesRankedBrands([
    { popularityRank: 3, brand: "New Balance" },
    { popularityRank: 1, brand: "Nike" },
    { popularityRank: 2, brandName: "나이키" },
    { popularityRank: 201, brand: "Adidas" },
  ], brands, 3);
  assert.deepEqual(ranked.map((brand) => brand.id), [144, 4]);
  assert.deepEqual(ranked.map((brand) => brand.salesRank), [1, 3]);
});

test("이전 판매순위 기록은 제외하고 가장 최근 200건만 사용한다", () => {
  const brands = [{ id: 144, name: "Nike", ko: "나이키" }, { id: 3, name: "Adidas", ko: "아디다스" }];
  const ranked = salesRankedBrands([
    { popularityRank: 1, brand: "Adidas", updatedAt: "2026-08-13T01:00:00.000Z" },
    { popularityRank: 1, brand: "Nike", updatedAt: "2026-08-14T01:00:00.000Z" },
  ], brands, 200);
  assert.deepEqual(ranked.map((brand) => brand.id), [144]);
});

test("브랜드 열이 비어 있어도 인기상품 이름에서 가장 구체적인 브랜드를 추출한다", () => {
  const brands = [
    { id: 1, name: "Adidas", ko: "아디다스" },
    { id: 2, name: "Adidas Originals", ko: "아디다스 오리지널스" },
    { id: 3, name: "Coach", ko: "코치" },
    { id: 4, name: "Crocs", ko: "크록스" },
    { id: 5, name: "Nike", ko: "나이키" },
  ];
  const ranked = salesRankedBrands([
    { popularityRank: 180, name: "COACH City Artist Bag" },
    { popularityRank: 186, name: "Crocs Crush Clog" },
    { popularityRank: 191, name: "Adidas Originals Campus" },
    { popularityRank: 197, name: "Nike SB Force 58" },
  ], brands, 200);
  assert.deepEqual(ranked.map((brand) => brand.id), [3, 4, 2, 5]);
});

test("카테고리 검색은 기존 인기리스트 200건 수집 후 연관 브랜드 조회를 시작한다", async () => {
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const categoryHandler = renderer.slice(
    renderer.indexOf('$("#category-search").addEventListener'),
    renderer.indexOf('$("#import-button").addEventListener'),
  );
  assert.match(categoryHandler, /capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
  assert.match(categoryHandler, /await window\.aroundG\.queryExplorer/);
  assert.ok(categoryHandler.indexOf("capturePopularProducts") < categoryHandler.indexOf("queryExplorer"));
  assert.match(renderer, /return \{ ok: true, products: storedProducts \}/);
});

test("카테고리 검색 결과와 재미있는 브랜드 상자 진행 화면을 보존한다", async () => {
  const [renderer, html, style, preload, main, storeSource] = await Promise.all([
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/style.css", import.meta.url), "utf8"),
    readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/store.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="category-brand-box"[\s\S]*id="category-box-brand"[\s\S]*📦/);
  assert.match(html, /👟[\s\S]*👕[\s\S]*👜[\s\S]*🧢/);
  assert.match(style, /@keyframes box-delivery/);
  assert.match(renderer, /categorySearchCacheId/);
  assert.match(renderer, /CATEGORY_SEARCH_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(renderer, /upsert\("categorySearches"/);
  assert.match(renderer, /cancelCategorySearch\(\)/);
  assert.match(preload, /cancelCategorySearch: \(\) => ipcRenderer\.invoke\("explorer:cancel-category"\)/);
  assert.match(main, /ipcMain\.handle\("explorer:cancel-category"/);
  assert.match(main, /rankedBrands\.find\(\(brand\) => Number\(brand\.id\) === Number\(detail\.brandId\)\)/);
  assert.match(main, /brandLogoUrl:/);
  assert.match(renderer, /progress\.phase === "start"/);
  assert.match(renderer, /categoryCompletedBrands/);
  assert.match(html, /id="category-box-logo"/);
  assert.match(html, /id="category-courier"/);
  assert.match(html, /id="category-completed-boxes"/);
  assert.match(style, /@keyframes scanner-line/);
  assert.doesNotMatch(html, />BRAND</);
  assert.match(storeSource, /categorySearches: \[\]/);
});
import { officialBrandSearchUrl } from "../relay/domestic-search.mjs";
import { JsonStore } from "../services/store.mjs";

test("the requested 3,388-brand catalog is accepted as a complete searchable catalog", () => {
  const source = {
    brands: Array.from({ length: 3388 }, (_value, index) => ({
      brandId: index + 1,
      brandName: `공식브랜드 ${index + 1}`,
      brandUrl: `/brand/official-${index + 1}`,
    })),
  };
  const brands = parseKrPoizonBrandData(source);
  assert.equal(brands.length, 3388);
  assert.ok(brands.length >= FULL_BRAND_CATALOG_MINIMUM);
  for (const brand of [brands[0], brands[1700], brands.at(-1)]) {
    const searchUrl = decodeURIComponent(officialBrandSearchUrl(brand.ko, "STYLE-001"));
    assert.match(searchUrl, new RegExp(brand.ko));
    assert.match(searchUrl, /STYLE-001/);
    assert.match(searchUrl, /shopping\.naver\.com\/window\/search\/fashion-group/);
    assert.doesNotMatch(searchUrl, /공식몰|공식스토어/);
  }
});

test("a complete brand catalog survives loss of the primary settings entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "around-g-brand-catalog-"));
  const complete = Array.from({ length: 3388 }, (_value, index) => ({
    id: index + 1,
    name: `Brand ${index + 1}`,
    ko: `브랜드 ${index + 1}`,
  }));
  const first = new JsonStore(directory);
  await first.load();
  await first.setSettings({ brandCatalog: complete, brandCatalogUpdatedAt: new Date().toISOString() });
  const primary = JSON.parse(await readFileFromDisk(join(directory, "around-g-data.json"), "utf8"));
  delete primary.settings.brandCatalog;
  await writeFile(join(directory, "around-g-data.json"), JSON.stringify(primary), "utf8");
  const restored = new JsonStore(directory);
  await restored.load();
  assert.equal(restored.snapshot().settings.brandCatalog.length, 3388);
});

test("missing, partial, and stale brand catalogs automatically request a refresh", () => {
  const complete = Array.from({ length: 3388 }, () => ({}));
  const now = Date.parse("2026-08-07T12:00:00Z");
  assert.equal(brandCatalogNeedsSync([], "", now), true);
  assert.equal(brandCatalogNeedsSync(complete.slice(0, 3299), new Date(now).toISOString(), now), true);
  assert.equal(brandCatalogNeedsSync(complete, new Date(now).toISOString(), now), false);
  assert.equal(brandCatalogNeedsSync(complete, new Date(now - BRAND_CATALOG_MAX_AGE_MS - 1).toISOString(), now), true);
});

test("the desktop automatically syncs and displays the full catalog", async () => {
  const [mainSource, rendererSource, storeSource] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../services/store.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /brands\.length < FULL_BRAND_CATALOG_MINIMUM/);
  assert.match(mainSource, /let englishBrands = \[\]/);
  assert.doesNotMatch(mainSource, /throw new Error\("EN_POIZON_BRAND_DATA_NOT_FOUND"\)/);
  assert.match(mainSource, /needsBrandSync: brandCatalogNeedsSync/);
  assert.match(rendererSource, /syncFullBrandCatalog\(\{ automatic: true \}\)/);
  assert.match(rendererSource, /const brands = matchedBrands;/);
  assert.doesNotMatch(rendererSource, /matchedBrands\.slice\(0, normalized \? 300 : 200\)/);
  assert.match(mainSource, /ensureOfficialDomainRegistry/);
  assert.match(rendererSource, /개 POIZON 브랜드/);
  assert.match(rendererSource, /공식몰 확인/);
  assert.match(mainSource, /safeOfficialDomainRegistry/);
  assert.match(mainSource, /preservedBrands/);
  assert.match(rendererSource, /저장된 브랜드/);
  assert.match(storeSource, /around-g-brand-catalog\.json/);
  assert.match(storeSource, /BRAND_CATALOG_BACKUP_MINIMUM/);
});
