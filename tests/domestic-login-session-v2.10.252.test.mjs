import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeRenderedStockEvidence } from "../relay/domestic-search.mjs";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

test("domestic login windows and hidden inventory checks share one persistent session", () => {
  assert.match(main, /DOMESTIC_SEARCH_PARTITION = "persist:around-g-domestic-search"/);
  assert.ok((main.match(/partition: DOMESTIC_SEARCH_PARTITION/g) || []).length >= 2);
  assert.match(main, /ipcMain\.handle\("domestic-login:list"/);
  assert.match(main, /ipcMain\.handle\("domestic-login:open"/);
  assert.match(preload, /listDomesticLogins/);
  assert.match(html, /국내 소싱몰 로그인/);
});

test("a redirected login page is never reported as inventory", () => {
  assert.deepEqual(normalizeRenderedStockEvidence({
    loginRequired: true,
    pageText: "로그인 후 구매할 수 있습니다",
    purchaseAvailable: true,
  }), {
    inStock: null,
    sizes: [],
    stockStatus: "login_required",
    stockVerified: false,
  });
});
