import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizePurchaseLedgerRow, validatePurchaseLedgerRow } from "../services/purchase-ledger.mjs";

test("purchase rows normalize manual and captured values consistently", () => {
  const row = normalizePurchaseLedgerRow({ orderNumber:" 20260903-1 ", articleNumber:"ji-0079", size:" KR 270 ", purchasePrice:"62,330원", purchaseDate:"2026-09-03 10:20", purchaseUrl:"https://www.musinsa.com/products/123?source=x", modelName:"테스트 상품" });
  assert.equal(row.articleNumber, "JI0079");
  assert.equal(row.purchasePrice, 62330);
  assert.equal(row.purchaseDate, "2026-09-03");
  assert.equal(row.purchaseUrl, "https://www.musinsa.com/products/123");
  assert.equal(row.status, "구매완료");
  assert.equal(row.duplicateKey.length, 24);
});

test("sheet write is blocked when required purchase evidence is missing", () => {
  const result = validatePurchaseLedgerRow(normalizePurchaseLedgerRow({ modelName:"상품" }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["품번", "사이즈", "구매일자", "구매가"]);
});

test("desktop exposes Musinsa capture, sheet sync, retry, and encrypted settings", async () => {
  const root = new URL("../", import.meta.url);
  const [main, preload, html, renderer, script] = await Promise.all([
    readFile(new URL("main.mjs", root), "utf8"), readFile(new URL("preload.cjs", root), "utf8"),
    readFile(new URL("src/index.html", root), "utf8"), readFile(new URL("src/renderer.js", root), "utf8"),
    readFile(new URL("services/google-ledger-apps-script.gs", root), "utf8"),
  ]);
  assert.match(main, /ledgerSecretEncrypted = encrypted/);
  assert.match(main, /ledger:sync/); assert.match(preload, /captureMusinsaLedger/);
  assert.match(html, /현재 주문 가져오기/); assert.match(renderer, /data-ledger-retry/);
  assert.match(script, /LockService/); assert.match(script, /구매완료/); assert.match(script, /duplicate: true/);
});
