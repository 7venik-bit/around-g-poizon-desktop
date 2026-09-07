import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { patchSellerBrowserFallback } from "../scripts/patch-seller-browser-fallback.mjs";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const start = main.indexOf("// Final compatibility fallback for layouts that reject physical events.");
const end = main.indexOf("    if (!advanced) {", start + 1);
assert.ok(start >= 0 && end > start, "shipping browser fallback exists");
const fallback = main.slice(start, end);
const literalStart = fallback.indexOf("executeJavaScript(") + "executeJavaScript(".length;
const literalEnd = fallback.lastIndexOf(", true)");
assert.ok(literalEnd > literalStart);
const renderScript = new Function("expectedNextPage", "expectedNextRowCount", "capture", "sellerPageResponseAttempts",
  "return " + fallback.slice(literalStart, literalEnd) + ";");

async function simulate({ target = 2, current = target, rowCount = 20, expectedRows = 20, previous = "previous page" } = {}) {
  let polls = 0;
  let clicks = 0;
  const visible = { getClientRects: () => [{}] };
  const active = { ...visible, textContent: String(target - 1) };
  const button = { click: () => { clicks += 1; active.textContent = String(current); } };
  const item = { ...visible, textContent: String(target), querySelector: () => button };
  const pagination = { ...visible,
    querySelector: (selector) => selector === ".ant-pagination-item-active" ? active : button,
    querySelectorAll: () => [item],
  };
  const rows = Array.from({ length: rowCount }, (_, index) => ({ ...visible, innerText: `상품 번호 : CODE${index} 최근 30일 판매량 100` }));
  const document = { querySelectorAll: (selector) => selector === "table tbody tr" ? rows : selector === ".ant-pagination" ? [pagination] : [item] };
  const script = renderScript(target, expectedRows, { currentPage: target - 1, rowSignature: previous }, 360);
  // Only browser globals are provided. Main-process variables must not leak in.
  const result = await runInNewContext(script, { document, setTimeout: (callback) => { polls += 1; callback(); } });
  return { result, polls, clicks };
}

test("isolated seller browser receives a concrete retry bound and parses spaced product labels", async () => {
  assert.deepEqual(await simulate(), { result: true, polls: 1, clicks: 1 });
});
test("partially rendered pages wait all 360 observations and cannot be accepted", async () => {
  assert.deepEqual(await simulate({ rowCount: 19 }), { result: false, polls: 360, clicks: 1 });
});
test("the last page accepts exactly its expected remainder rows", async () => {
  assert.equal((await simulate({ target: 150, rowCount: 3, expectedRows: 3 })).result, true);
});
test("the wrong active page never passes row verification", async () => {
  assert.equal((await simulate({ current: 1 })).result, false);
});
test("unchanged page content never passes navigation verification", async () => {
  const previous = Array.from({ length: 20 }, (_, index) => `상품 번호 : CODE${index} 최근 30일 판매량 100`).join("␞");
  assert.equal((await simulate({ previous })).result, false);
});
test("the source repair is idempotent", () => {
  assert.equal(patchSellerBrowserFallback(main), main);
});
