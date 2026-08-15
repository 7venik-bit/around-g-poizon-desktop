import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("POIZON credentials are entered locally and stored with Windows encryption", () => {
  assert.match(html, /id="poizon-login-id"/);
  assert.match(html, /id="poizon-password" type="password"/);
  assert.match(main, /poizonPasswordEncrypted = encrypted\(config\.poizonPassword\)/);
  assert.match(main, /decrypted\(settings\.poizonPasswordEncrypted\)/);
  assert.match(main, /"poizonLoginId", "poizonPasswordEncrypted"/);
});

test("brand search automatically resumes after stored-login submission", () => {
  assert.match(main, /submitStoredSellerCredentials/);
  assert.match(main, /ensureSellerLoginBeforeBrandSearch\(brandName\)/);
  assert.match(main, /STORED_CREDENTIALS_SUBMITTED/);
  assert.match(main, /로그인 완료 · 브랜드 검색 자동 재개/);
});

test("all three lamps chase in order while sourcing", () => {
  assert.match(renderer, /lamps\.classList\.toggle\("sourcing", sourcing\)/);
  assert.match(css, /\.window-dots\.sourcing i\{animation:poizon-work-lamp-chase/);
  assert.match(css, /nth-child\(2\).*animation-delay:\.18s/);
  assert.match(css, /nth-child\(3\).*animation-delay:\.36s/);
});

test("brand progress rows support checkbox selection and selected deletion", () => {
  assert.match(html, /id="brand-batch-select-all"/);
  assert.match(html, /id="brand-batch-delete"/);
  assert.match(renderer, /selectedBrandBatchKeys/);
  assert.match(renderer, /brandBatchStates\.delete\(key\)/);
});
