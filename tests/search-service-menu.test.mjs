import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bootstrap, menuSource, menuCss, html, packageSource] = await Promise.all([
  readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../src/search-service-menu.css", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("restores the three POIZON search services in the sidebar", () => {
  assert.match(menuSource, /\{ id: "popular", label: "인기리스트"/);
  assert.match(menuSource, /\{ id: "brand", label: "브랜드 검색"/);
  assert.match(menuSource, /\{ id: "category", label: "카테고리"/);
  assert.match(menuSource, /검색 서비스/);
  assert.match(menuSource, /data-service-explorer="\$\{item\.id\}"/);
});

test("removes the redundant POIZON parent menu row", () => {
  assert.match(menuSource, /productsNav\.hidden = true/);
  assert.match(menuSource, /productsNav\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(menuSource, /productsNav\.tabIndex = -1/);
});

test("removes the brand screen title and three-step guide", () => {
  assert.match(html, /<h2>POIZON 원본 데이터 가져오기<\/h2>/);
  assert.match(html, /class="brand-fetch-action brand-excel-flow"/);
  assert.match(menuSource, /brandHeading\.remove\(\)/);
  assert.match(menuSource, /brandFlow\.remove\(\)/);
  assert.match(menuSource, /brandPanel\.prepend\(legacyBrandSearch\)/);
});

test("keeps the downloaded Excel screen separate from the three search services", () => {
  assert.match(menuSource, /\{ id: "files", label: "받은 Excel 파일", group: "files" \}/);
  assert.match(menuSource, /데이터 파일/);
  assert.match(menuSource, /data-service-explorer="files"/);
});

test("sidebar buttons reactivate the existing explorer panels", () => {
  assert.match(html, /id="explorer-popular"/);
  assert.match(html, /id="explorer-brand"/);
  assert.match(html, /id="explorer-category"/);
  assert.match(menuSource, /target\.hidden = false/);
  assert.match(menuSource, /target\.classList\.add\("active"\)/);
  assert.match(menuSource, /clearExplorerResults/);
});

test("bootstrap injects the sidebar menu and its stylesheet into the main window", () => {
  assert.match(bootstrap, /search-service-menu\.js/);
  assert.match(bootstrap, /search-service-menu\.css/);
  assert.match(bootstrap, /insertCSS/);
  assert.match(bootstrap, /executeJavaScript\(searchServiceMenuSource/);
  assert.match(menuCss, /\.search-service-button\.active/);
});

test("release version is 2.10.176", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.176");
});
