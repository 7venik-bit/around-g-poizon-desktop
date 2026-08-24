import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const menu = await readFile(new URL("../src/search-service-menu.js", import.meta.url), "utf8");

test("restores Popular Brand Category as visible search services", () => {
  assert.match(menu, /label: "인기리스트"/);
  assert.match(menu, /label: "브랜드"/);
  assert.match(menu, /label: "카테고리"/);
  assert.doesNotMatch(menu, /id: "category"[^\n]*hidden: true/);
});

test("loads restored search menu assets from the main UI", () => {
  assert.match(index, /search-service-menu\.css/);
  assert.match(index, /search-service-menu\.js/);
  assert.match(menu, /받은 Excel 파일/);
});
