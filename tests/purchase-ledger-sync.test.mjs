import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizePurchaseLedgerRow, validatePurchaseLedgerRow } from "../services/purchase-ledger.mjs";
import { PURCHASE_LEDGER_BACKUP_COLUMNS, purchaseLedgerBackupRows, weeklyLedgerBackupDue } from "../services/purchase-ledger-backup.mjs";

test("purchase rows normalize manual and captured values consistently", () => {
  const row = normalizePurchaseLedgerRow({ orderNumber:" 20260903-1 ", articleNumber:"ji-0079", size:" KR 270 ", purchasePrice:"62,330원", purchaseDate:"2026-09-03 10:20", purchaseUrl:"https://www.musinsa.com/products/123?source=x", modelName:"테스트 상품" });
  assert.equal(row.articleNumber, "JI0079");
  assert.equal(row.purchasePrice, 62330);
  assert.equal(row.purchaseDate, "2026-09-03");
  assert.equal(row.purchaseUrl, "https://www.musinsa.com/products/123");
  assert.equal(row.status, "구매완료");
  assert.equal(row.duplicateKey.length, 24);
});

test("weekly ledger backup becomes due after seven days", () => {
  const now = new Date("2026-09-16T12:00:00.000Z");
  assert.equal(weeklyLedgerBackupDue("", now), true);
  assert.equal(weeklyLedgerBackupDue("2026-09-10T12:00:01.000Z", now), false);
  assert.equal(weeklyLedgerBackupDue("2026-09-09T12:00:00.000Z", now), true);
});

test("ledger Excel rows keep visible purchase fields and newest purchases first", () => {
  const rows = purchaseLedgerBackupRows([
    { modelName: "이전 상품", purchaseDate: "2026-09-01", euSize: "42", quantity: 0, purchasePrice: "10000" },
    { modelName: "최신 상품", purchaseDate: "2026-09-15", krSize: "270", quantity: 2, purchasePrice: 20000 },
  ]);
  assert.equal(rows[0].modelName, "최신 상품");
  assert.equal(rows[0].size, "270");
  assert.equal(rows[1].size, "42");
  assert.equal(rows[1].quantity, 1);
  assert.ok(PURCHASE_LEDGER_BACKUP_COLUMNS.some(([label, key]) => label === "Google 시트 기록상태" && key === "syncStatus"));
});

test("desktop writes the weekly ledger workbook into OneDrive", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /"Around G POIZON", "구매장부 백업"/);
  assert.match(main, /Around-G-구매장부-/);
  assert.match(main, /lastLedgerBackupAt/);
  assert.match(main, /reason: "EMPTY_LEDGER"/);
  assert.match(main, /void runWeeklyLedgerBackup\(\)/);
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
  assert.match(html, /장부기록/); assert.match(renderer, /data-ledger-retry/);
  assert.match(renderer, /row\.imageUrl/); assert.match(renderer, /row\.purchasePrice/);
  assert.match(renderer, /row\.krSize \|\| row\.euSize/);
  assert.match(script, /LockService/); assert.match(script, /구매완료/); assert.match(script, /duplicate: true/);
});

test("Musinsa ledger opens the current My page and explains login or detail selection", async () => {
  const root = new URL("../", import.meta.url);
  const [main, html] = await Promise.all([
    readFile(new URL("main.mjs", root), "utf8"),
    readFile(new URL("src/index.html", root), "utf8"),
  ]);
  assert.doesNotMatch(main, /musinsa\.com\/mypage\/orders/);
  assert.match(main, /loadURL\("https:\/\/www\.musinsa\.com\/mypage"\)/);
  assert.match(main, /MUSINSA_LOGIN_REQUIRED/);
  assert.match(main, /captureMusinsaLedgerPage/);
  assert.match(main, /ORDER_DETAIL_REQUIRED/);
  assert.match(html, /무신사 주문 내역 열기/);
  assert.match(html, /로그인 상태는 다음 실행에도 유지/);
});

test("Musinsa ledger imports Google account credentials once and persists its login session", async () => {
  const [main, html, renderer] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  ]);
  assert.match(main, /function musinsaCredentialsFromGoogleWorkbook\(workbook\)/);
  assert.match(main, /String\(item\?\.name \|\| ""\)\.trim\(\) === "계정정보"/);
  assert.match(main, /services\.accounts\.save\(\{ id: "musinsa", method: "password", \.\.\.credentials \}\)/);
  assert.match(main, /if \(!await hasUsableDomesticLoginSession\("musinsa"\)\)/);
  assert.match(main, /cookies\.flushStore\(\)/);
  assert.match(main, /partition: DOMESTIC_SEARCH_PARTITION/);
  assert.match(html, /Google Drive 계정정보의 무신사 계정을 Windows에 암호화 저장/);
  assert.match(renderer, /MUSINSA_ACCOUNT_NOT_FOUND/);
});

