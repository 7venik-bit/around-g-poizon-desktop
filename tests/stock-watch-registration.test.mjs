import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { JsonStore } from "../services/store.mjs";

test("stock-watch entries persist independently from product searches", async () => {
  const folder = await mkdtemp(join(tmpdir(), "around-g-stock-watch-"));
  const store = new JsonStore(folder);
  await store.load();
  const saved = await store.upsert("stockWatches", {
    platform: "무신사",
    brand: "코오롱스포츠",
    name: "테스트 상품",
    articleNumber: "TEST-001",
    option: "블랙 / 270",
    url: "https://www.musinsa.com/products/1",
    watchStatus: "registered",
  });
  assert.ok(saved.id);
  assert.equal(store.snapshot().stockWatches.length, 1);
  assert.equal(store.snapshot().domesticSearches.length, 0);

  const restored = new JsonStore(folder);
  await restored.load();
  assert.equal(restored.snapshot().stockWatches[0].articleNumber, "TEST-001");
});

test("stock-watch menu exposes registration, edit and delete controls", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
  const inline = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
  assert.match(html, /data-view="stock-watch">재고 감시 등록/);
  assert.match(html, /id="stock-watch-back-to-brand"[^>]*>← 브랜드 검색 결과로/);
  assert.match(html, /id="stock-watch-platform"/);
  assert.match(html, /id="stock-watch-url"/);
  assert.match(renderer, /upsert\("stockWatches"/);
  assert.match(renderer, /data-stock-edit/);
  assert.match(renderer, /data-remove="stockWatches:/);
  assert.match(renderer, /function stockWatchRegistrationButton/);
  assert.match(renderer, /data-stock-register/);
  assert.match(renderer, /stock-watch-back-to-brand/);
  assert.match(renderer, /nav\[data-view="products"\]/);
  assert.match(sourcing, /stockWatchRegistrationButton\(product, sourceProduct\)/);
  assert.match(inline, /stockWatchRegistrationButton\(product, sourceProduct\)/);
});
