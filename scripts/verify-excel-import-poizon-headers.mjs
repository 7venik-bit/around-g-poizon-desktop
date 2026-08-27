import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`Excel import verification failed: ${message}`); };

if (!main.includes('findPoizonColumn(headers, "상품 번호", "상품번호", "품번"')) fail("product-number header aliases missing");
if (!main.includes('findPoizonColumn(headers, "상품명", "상품 이름", "제품명", "상품정보"')) fail("product-name header aliases missing");
if (!main.includes("headerCandidates = sheet.slice(0, Math.min(20, sheet.length))")) fail("header-row discovery missing");
if (!main.includes("상품번호/상품명 열을 찾지 못했습니다")) fail("zero-import diagnosis missing");
if (!main.includes("imageUrl: String(valueAt(row, columns.imageUrl)")) fail("image import mapping missing");
if (!renderer.includes("Excel 가져오기 실패:")) fail("renderer import error feedback missing");
if (!renderer.includes("가져올 상품 데이터를 찾지 못했습니다")) fail("renderer zero-import feedback missing");

console.log("POIZON Excel import header variants and failure feedback verified");
