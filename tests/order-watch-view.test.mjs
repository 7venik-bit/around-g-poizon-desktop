import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const preload = fs.readFileSync(new URL("../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const style = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const store = fs.readFileSync(new URL("../services/store.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// POIZON seller-center order management mirror: daily snapshot, alarms, tabs.

test("orders view mirrors the seller-center management screen", () => {
  const start = html.indexOf('id="orders"');
  assert.ok(start >= 0);
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.match(section, /id="order-watch-tabs"/);
  assert.match(section, /id="order-watch-rows"/);
  assert.match(section, /id="order-watch-sync"/);
  assert.match(section, /id="order-watch-query"/);
  assert.match(section, /상품 정보/);
  assert.match(section, /주문 번호/);
  assert.doesNotMatch(section, /add-record/);
});

test("renderer drives tabs, filter, sync, and progress", () => {
  assert.match(renderer, /function refreshOrderWatch\(\)/);
  assert.match(renderer, /function renderOrderWatch\(\)/);
  assert.match(renderer, /data-order-watch-tab/);
  assert.match(renderer, /window\.aroundG\.syncOrderWatch/);
  assert.match(renderer, /window\.aroundG\.getOrderWatch/);
  assert.match(renderer, /onOrderWatchProgress/);
  assert.match(renderer, /nav\.dataset\.view === "orders"/);
  assert.match(style, /\.order-watch-tabs button\.active/);
  assert.match(style, /\.order-watch-badge\.new/);
});

test("main process syncs daily with alarms and IPC", () => {
  assert.match(main, /async function syncPoizonOrderWatch/);
  assert.match(main, /ipcMain\.handle\("order-watch:sync"/);
  assert.match(main, /ipcMain\.handle\("order-watch:get"/);
  assert.match(main, /order-watch:progress/);
  assert.match(main, /seller\.poizon\.com\/main\/orders\/management/);
  assert.match(main, /6\*60\*60\*1_000/);
  assert.match(preload, /syncOrderWatch/);
  assert.match(preload, /getOrderWatch/);
  assert.match(preload, /onOrderWatchProgress/);
  assert.match(store, /orderWatch: \[\]/);
});
