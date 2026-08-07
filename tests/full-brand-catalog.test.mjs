import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BRAND_CATALOG_MAX_AGE_MS,
  FULL_BRAND_CATALOG_MINIMUM,
  brandCatalogNeedsSync,
  parseKrPoizonBrandData,
} from "../services/brand-catalog.mjs";
import { officialBrandSearchUrl } from "../relay/domestic-search.mjs";

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

test("missing, partial, and stale brand catalogs automatically request a refresh", () => {
  const complete = Array.from({ length: 3388 }, () => ({}));
  const now = Date.parse("2026-08-07T12:00:00Z");
  assert.equal(brandCatalogNeedsSync([], "", now), true);
  assert.equal(brandCatalogNeedsSync(complete.slice(0, 3299), new Date(now).toISOString(), now), true);
  assert.equal(brandCatalogNeedsSync(complete, new Date(now).toISOString(), now), false);
  assert.equal(brandCatalogNeedsSync(complete, new Date(now - BRAND_CATALOG_MAX_AGE_MS - 1).toISOString(), now), true);
});

test("the desktop automatically syncs the full catalog and keeps brand filtering responsive", async () => {
  const [mainSource, rendererSource] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /brands\.length < FULL_BRAND_CATALOG_MINIMUM/);
  assert.match(mainSource, /let englishBrands = \[\]/);
  assert.doesNotMatch(mainSource, /throw new Error\("EN_POIZON_BRAND_DATA_NOT_FOUND"\)/);
  assert.match(mainSource, /needsBrandSync: brandCatalogNeedsSync/);
  assert.match(rendererSource, /syncFullBrandCatalog\(\{ automatic: true \}\)/);
  assert.match(rendererSource, /matchedBrands\.slice\(0, normalized \? 300 : 200\)/);
  assert.match(mainSource, /ensureOfficialDomainRegistry/);
  assert.match(rendererSource, /개 POIZON 브랜드/);
  assert.match(rendererSource, /공식몰 확인/);
});
