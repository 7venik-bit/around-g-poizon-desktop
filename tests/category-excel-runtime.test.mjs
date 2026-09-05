import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { basename } from "node:path";
import * as xlsx from "../services/poizon-xlsx.mjs";
import { filterPoizonPreviewRows, parsePoizonSalesMetric } from "../services/poizon-sales-filter.mjs";

// Execute the shipping functions and click handler, not a reimplementation or
// a regex asserting that a line of code happens to exist.
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `runtime section: ${start}`);
  return source.slice(from, to);
};
const previewSource = section(main, "function excelPreviewCell(", "async function scanBrandExportFolder(");
const brandSource = section(renderer, "function normalizeBrandKey(", "function completedDownloadBrands(");
const loaderSource = section(renderer, "function salesByArticle(", "function renderOfficialDomainAudit(");
const filterSource = section(renderer, "const CATEGORY_SEARCH_RETENTION_MS", "async function pruneCategorySearchHistory(");
const handlerSource = section(renderer, '$("#category-search").addEventListener', '$("#import-button").addEventListener');
const standardHeaders = ["SPU ID", "상품 번호", "상품명", "카테고리 소분류", "최근 30일 판매량", "현지 판매자 최근 30일 판매량"];
const vest = ["19438508", "JWVAX25017", "코오롱스포츠 남성 조끼", "조끼", "100+", 83];
const initialBrand = { id: 1000444, name: "KOLON SPORT", ko: "코오롱스포츠" };

function harness({ sheets = { "/kolon.xlsx": [standardHeaders, vest] }, brands = [initialBrand], files,
  china = "100", local = "30", histories = [], previewOverride } = {}) {
  const nodes = new Map(), reads = [], saved = [], rendered = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", disabled: false, className: "", textContent: "", addEventListener(_event, callback) { this.callback = callback; } });
    return nodes.get(id);
  };
  $("#category-min-china-sales30").value = china;
  $("#category-min-local-sales30").value = local;
  const previewContext = createContext({ ...xlsx, filterPoizonPreviewRows, parsePoizonSalesMetric,
    excelPreviewCache: new Map(), basename,
    stat: async (path) => { if (!(path in sheets)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }); return { size: 100, mtimeMs: 1 }; },
    readFile: async (path) => sheets[path], readFirstDataSheet: async (rows) => rows,
  });
  runInContext(previewSource, previewContext);
  const preview = async (path, offset, limit, filters) => {
    reads.push(path);
    if (previewOverride) return previewOverride(path, offset, limit, filters);
    return previewContext.previewExcelFile({ path, offset, limit, filters });
  };
  const context = createContext({ $, console, Date, Intl, state: { categorySearches: histories, products: [] },
    downloadedBrandFiles: files || [{ path: "/kolon.xlsx", name: "kolon.xlsx", brandName: "코오롱스포츠", time: 1 }],
    explorerMeta: { brands }, categoryBrandIds: new Set(brands.map((brand) => brand.id)), pinnedBrandIds: [],
    selectedCategory: "아우터", selectedCategoryDetail: "베스트", categorySearchRunId: 0,
    refresh: async () => {}, pruneCategorySearchHistory: async () => {},
    startCategoryLoading: () => {}, updateCategoryLoading: () => {}, finishCategoryLoading: () => {},
    renderExplorerResults: (_title, products) => rendered.push(JSON.parse(JSON.stringify(products))),
    window: { setTimeout: () => {}, aroundG: { previewExcelFile: preview,
      queryExplorer: () => { throw new Error("NETWORK_QUERY_FORBIDDEN"); },
      upsert: async (_collection, record) => { saved.push(JSON.parse(JSON.stringify(record))); return record; },
    } },
  });
  runInContext(brandSource + loaderSource + filterSource + handlerSource, context);
  return { context, sheets, reads, saved, rendered, nodes, previewContext,
    click: async () => $("#category-search").callback(), status: () => $("#category-status").textContent };
}

test("retries Excel even when history marked a failed brand completed", async () => {
  const h = harness();
  const oldId = h.context.categorySearchCacheId("아우터", "베스트", 100, 30, [1000444]);
  h.context.state.categorySearches = [{ id: oldId, completedBrandIds: [1000444], products: [], sourceCount: 0, failedSourceCount: 1, complete: false }];
  await h.click();
  assert.equal(h.reads.length, 1, "must actually read the local workbook");
  assert.equal(h.rendered.at(-1).length, 1);
});

test("decorated recent-sales headers agree with the Excel parser", async () => {
  const headers = [...standardHeaders];
  headers[4] = "최근 30일 판매량 (중국)";
  headers[5] = "현지 판매자 최근 30일 판매량 (건)";
  const h = harness({ sheets: { "/kolon.xlsx": [headers, vest] } });
  await h.click();
  assert.equal(h.saved.at(-1)?.sourceCount, 1);
  assert.equal(h.rendered.at(-1)?.[0].sales30d, 100);
  assert.equal(h.rendered.at(-1)?.[0].localSales30d, 83);
});

test("file read error stays visible and is not saved as completed", async () => {
  const h = harness({ sheets: {} });
  await h.click();
  assert.match(h.status(), /ENOENT|파일.*찾|파일.*없/);
  assert.match(h.status(), /코오롱스포츠/);
  assert.deepEqual(h.saved.at(-1)?.completedBrandIds || [], []);
  assert.equal(h.saved.at(-1)?.complete, false);
});

test("two failed Excel reads do not stop the remaining brand queue", async () => {
  const brands = [initialBrand, { id: 2, name: "TestTwo" }, { id: 3, name: "TestThree" }];
  const files = brands.map((brand, index) => ({ path: `/${index}.xlsx`, name: `${index}.xlsx`, brandName: brand.name, time: 1 }));
  const h = harness({ brands, files, previewOverride: async (path) => path === "/2.xlsx"
    ? { ok: true, headers: standardHeaders, totalRows: 1, salesColumns: { china: 4, local: 5 }, products: [{ articleNumber: "TEST", title: "조끼", sales30d: 100, localSales30d: 50, hasSalesData: true, hasLocalSalesData: true }] }
    : { ok: false, message: "FILE_READ_FAILED" } });
  await h.click();
  assert.equal(h.reads.length, 3);
  assert.equal(h.saved.at(-1)?.sourceCount, 1);
  assert.deepEqual(h.saved.at(-1)?.completedBrandIds, [3]);
  assert.equal(h.saved.at(-1)?.complete, false);
});

test("a valid empty workbook is success with zero products", async () => {
  const h = harness({ sheets: { "/kolon.xlsx": [standardHeaders] } });
  await h.click();
  assert.equal(h.saved.at(-1)?.sourceCount, 1);
  assert.equal(h.saved.at(-1)?.complete, true);
  assert.deepEqual(h.rendered.at(-1), []);
});

test("no sales constraints allows a workbook without sales columns", async () => {
  const h = harness({ china: "", local: "", sheets: { "/kolon.xlsx": [standardHeaders.slice(0, 4), vest.slice(0, 4)] } });
  await h.click();
  assert.equal(h.rendered.at(-1)?.length, 1);
});

test("a local-only sales column must never masquerade as China sales", async () => {
  const h = harness({ sheets: { "/kolon.xlsx": [[...standardHeaders.slice(0, 4), standardHeaders[5]], [...vest.slice(0, 4), 83]] } });
  await h.click();
  assert.match(h.status(), /중국.*30일.*열/);
  const products = h.previewContext.buildExcelPreviewProducts([...standardHeaders.slice(0, 4), standardHeaders[5]], [{ values: [...vest.slice(0, 4), 83], sourceRowNumber: 2 }]);
  assert.equal(products[0].sales30d, 0);
  assert.equal(products[0].hasSalesData, false);
});

test("AND filtering excludes low sales, other categories, and missing metrics at threshold zero", async () => {
  const h = harness({ sheets: { "/kolon.xlsx": [standardHeaders, vest,
    ["21228734", "JWVAM25301", "남성 경량 방풍 조끼", "조끼", "200+", 37],
    ["2", "LOWCN", "남성 조끼", "조끼", 99, 83],
    ["3", "LOWLOCAL", "남성 조끼", "조끼", 200, 29],
    ["4", "JACKET", "남성 자켓", "자켓", 200, 83],
    ["5", "MISSING", "남성 조끼", "조끼", "--", "--"],
  ] } });
  await h.click();
  assert.deepEqual(h.rendered.at(-1).map((p) => p.articleNumber), ["JWVAX25017", "JWVAM25301"]);
  h.nodes.get("#category-min-china-sales30").value = "0";
  h.nodes.get("#category-min-local-sales30").value = "0";
  await h.click();
  assert.ok(!h.rendered.at(-1).some((p) => p.articleNumber === "MISSING"));
});

test("a fresh search ignores even completed cached results", async () => {
  const h = harness();
  await h.click();
  h.context.state.categorySearches = [h.saved.at(-1)];
  h.previewContext.excelPreviewCache.clear();
  h.sheets["/kolon.xlsx"] = [standardHeaders, [...vest.slice(0, 4), 1, 1]];
  await h.click();
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.rendered.at(-1), []);
});

test("only the enabled sales constraint requires its column", async () => {
  const h = harness({ china: "", sheets: { "/kolon.xlsx": [[...standardHeaders.slice(0, 4), standardHeaders[5]], [...vest.slice(0, 4), 83]] } });
  await h.click();
  assert.equal(h.rendered.at(-1).length, 1);
  assert.equal(h.saved.at(-1).complete, true);
});

test("explicit zero sales is available data at threshold zero", async () => {
  const h = harness({ china: "0", local: "0", sheets: { "/kolon.xlsx": [standardHeaders, [...vest.slice(0, 4), 0, "0"]] } });
  await h.click();
  assert.equal(h.rendered.at(-1).length, 1);
  assert.equal(h.rendered.at(-1)[0].hasSalesData, true);
  assert.equal(h.rendered.at(-1)[0].hasLocalSalesData, true);
});

test("ambiguous headers and total-sales columns cannot substitute for recent sales", () => {
  assert.deepEqual(xlsx.findPoizonRecentSalesColumns(["총 판매량", "현지 판매자 총 판매량"]), { china: -1, local: -1 });
  assert.deepEqual(xlsx.findPoizonRecentSalesColumns(["최근 30일 판매량", "중국 최근 30일 판매량", "현지 판매자 최근 30일 판매량"]), { china: -1, local: 2 });
  assert.deepEqual(xlsx.findPoizonRecentSalesColumns(["\uFEFF중국 시장 최근 ３０일간 판매량 (건)", "현지 판매자 최근 30일간 판매량"]), { china: 0, local: 1 });
});

test("local selection reads beyond the first 100000 products", async () => {
  const offsets = [];
  const h = harness({ previewOverride: async (_path, offset) => {
    offsets.push(offset);
    return { ok: true, offset, totalRows: 100001, salesColumns: { china: 4, local: 5 },
      products: offset === 0 ? Array(100000).fill({ articleNumber: "FIRST_PAGE" }) : [{ articleNumber: "LAST_PAGE" }] };
  } });
  const result = await h.context.downloadedBrandSalesByArticle(initialBrand, { minimumChinaSales30: 100, minimumLocalSales30: 30 });
  assert.equal(result.ok, true);
  assert.equal(result.productCount, 100001);
  assert.equal(result.products.at(-1).articleNumber, "LAST_PAGE");
  assert.deepEqual(offsets, [0, 100000]);
});
