import { readFile, writeFile } from "node:fs/promises";

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = String(await readFile(rendererPath, "utf8")).replace(/\r\n/g, "\n");

renderer = renderer.replaceAll("검색 입력 실패", "검색 결과 확인");
renderer = renderer.replaceAll(
  "상품코드를 검색창에 입력하고 검색 버튼을 누르는 단계에서 중단됐습니다.",
  "검색 결과 화면을 확인하고 있습니다.",
);

await writeFile(rendererPath, renderer, "utf8");
console.log("obsolete search-input-failure wording removed");
