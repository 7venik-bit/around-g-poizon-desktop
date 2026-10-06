import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  POPULAR_EXCEL_HEADERS,
  createPopularSlots,
  excelRowsToPopularProducts,
  popularSlotsToExcelData,
  resolvePopularSpuIds,
} from "../services/popular-excel.mjs";
import { sellerProductId } from "../services/poizon-product-viewer.mjs";

const mainSource = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inlineResults = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

const stageStart = mainSource.indexOf('ipcMain.handle("excel:stage-popular-products"');
const stageEnd = mainSource.indexOf('ipcMain.handle("popular:workflow-get"', stageStart);
const stageHandler = mainSource.slice(stageStart, stageEnd);

test("popular Excel keeps the SPU ID column behind the collection status", () => {
  assert.equal(POPULAR_EXCEL_HEADERS.length, 11);
  assert.equal(POPULAR_EXCEL_HEADERS[9], "수집 상태");
  assert.equal(POPULAR_EXCEL_HEADERS[10], "SPU ID");
});

test("popular Excel round-trip preserves the resolved SPU", () => {
  const slots = createPopularSlots([
    { rank: 1, articleNumber: "IB4595-001", name: "나이키 이니시에이터", brandName: "나이키", averagePrice: 56768, globalSpuId: "123456", spuId: "123456", logoUrl: "https://example.test/a.jpg" },
    { rank: 2, articleNumber: "415445-102", name: "나이키 에어 모나크", brandName: "나이키", averagePrice: 60280, logoUrl: "" },
  ]);
  const rows = popularSlotsToExcelData(slots).map((row) => row.map((cell) => cell.value));
  assert.deepEqual(rows[0], POPULAR_EXCEL_HEADERS);
  const restored = excelRowsToPopularProducts(rows);
  assert.equal(restored[0].spuId, "123456");
  assert.equal(restored[0].globalSpuId, "123456");
  assert.equal(restored[0].missingRank, false);
  assert.equal(sellerProductId(restored[0]), "123456");
  assert.equal(restored[1].spuId, "");
  assert.equal(sellerProductId(restored[1]), "");
  assert.equal(String(rows[1][9]), "완료");
});

test("SPU confirmation maps every article and never drops a slot", async () => {
  const calls = [];
  const progress = [];
  const waits = [];
  const lookupArticle = async (articleNumber) => {
    calls.push(articleNumber);
    if (articleNumber === "FAIL-001") throw new Error("SPU_LOOKUP_FAILED");
    if (articleNumber === "EMPTY-001") return null;
    return { globalSpuId: `990${calls.length}`, spuId: `880${calls.length}` };
  };
  const products = [
    { rank: 1, articleNumber: "IB4595-001", name: "a" },
    { rank: 2, articleNumber: "FAIL-001", name: "b" },
    { rank: 3, articleNumber: "EMPTY-001", name: "c" },
    { rank: 4, articleNumber: "", name: "d" },
  ];
  const { products: resolved, matched } = await resolvePopularSpuIds(products, {
    lookupArticle,
    onProgress: (state) => progress.push(state),
    waitImpl: async (ms) => { waits.push(ms); },
    paceMs: 0,
  });
  assert.equal(matched, 1);
  assert.equal(resolved[0].globalSpuId, "9901");
  assert.equal(resolved[0].spuId, "8801");
  assert.equal(sellerProductId(resolved[0]), "9901");
  assert.deepEqual(resolved[1], products[1]);
  assert.deepEqual(resolved[2], products[2]);
  assert.deepEqual(calls, ["IB4595-001", "FAIL-001", "EMPTY-001"]);
  assert.equal(progress.length, 4);
  assert.deepEqual(progress[3], { completed: 4, total: 4, matched: 1 });
  assert.equal(waits.length, 3);
});

test("SPU confirmation without a lookup keeps every slot", async () => {
  const products = [{ rank: 1, articleNumber: "IB4595-001", name: "a" }];
  const result = await resolvePopularSpuIds(products, {});
  assert.deepEqual(result, { products, matched: 0 });
  const empty = await resolvePopularSpuIds([], { lookupArticle: async () => null });
  assert.deepEqual(empty, { products: [], matched: 0 });
});

test("popular staging confirms SPUs with progress before writing Excel", () => {
  assert.match(stageHandler, /resolvePopularSpuIds\(slots,/);
  assert.match(stageHandler, /queryPoizon\(poizonConfig, \{ mode: "article"/);
  assert.match(stageHandler, /포이즌 SPU 확인 중/);
  assert.match(stageHandler, /seller:capture-progress/);
  assert.match(stageHandler, /\{ width: 42 \}, \{ width: 12 \},\s*\{ width: 20 \},/);
});

test("inline product rows expose the same per-row search as brand rows", () => {
  const start = inlineResults.indexOf("const inlineExcelRenderer = function inlineExcelProductRows(");
  const end = inlineResults.indexOf("inlineExcelRenderer.__aroundGSourcingView", start);
  const renderer = inlineResults.slice(start, end);
  assert.match(renderer, /<th>상품검색<\/th>/);
  assert.match(renderer, /data-excel-search-product="\$\{encodeURIComponent\(key\)\}"/);
  assert.match(renderer, /<td colspan="11"><div class="domestic-inline-detail-label">/);
  assert.match(renderer, /<tr><td class="empty" colspan="11">/);
});
