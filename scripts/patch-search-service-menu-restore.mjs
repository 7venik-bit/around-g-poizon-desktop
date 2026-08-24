import { readFile, writeFile } from "node:fs/promises";

const indexUrl = new URL("../src/index.html", import.meta.url);
const menuUrl = new URL("../src/search-service-menu.js", import.meta.url);

let menu = await readFile(menuUrl, "utf8");
menu = menu.replace('{ id: "brand", label: "브랜드 검색", group: "search" }', '{ id: "brand", label: "브랜드", group: "search" }');
menu = menu.replace('{ id: "category", label: "카테고리 검색", group: "search", hidden: true }', '{ id: "category", label: "카테고리", group: "search" }');
await writeFile(menuUrl, menu, "utf8");

let html = await readFile(indexUrl, "utf8");
if (!html.includes('href="./search-service-menu.css"')) {
  html = html.replace(
    '<link rel="stylesheet" href="./style.css">',
    '<link rel="stylesheet" href="./style.css">\n  <link rel="stylesheet" href="./search-service-menu.css">',
  );
}
if (!html.includes('src="./search-service-menu.js"')) {
  html = html.replace(
    '<script src="./renderer.js"></script>',
    '<script src="./renderer.js"></script>\n  <script src="./search-service-menu.js"></script>',
  );
}
await writeFile(indexUrl, html, "utf8");

console.log("Restored POIZON search menus: 인기리스트 / 브랜드 / 카테고리; Excel remains under 데이터 파일.");
