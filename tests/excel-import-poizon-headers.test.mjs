import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findPoizonColumn } from "../services/poizon-xlsx.mjs";

const poizonHeaders = ["SPU ID", "상품 번호", "상품명", "브랜드", "평균 거래가", "상품 이미지"];
assert.equal(findPoizonColumn(poizonHeaders, "상품 번호", "상품번호", "품번"), 1, "POIZON spaced product-number header must be recognized");
assert.equal(findPoizonColumn(poizonHeaders, "상품명", "상품 이름", "제품명", "상품정보"), 2, "POIZON product-name header must be recognized");
assert.equal(findPoizonColumn(poizonHeaders, "브랜드", "브랜드명", "Brand"), 3, "brand header must be recognized");
assert.equal(findPoizonColumn(poizonHeaders, "POIZON 가격", "포이즌 가격", "평균 거래가", "평균거래가"), 4, "POIZON average-price header must be accepted as price input");

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
assert.match(main, /headerCandidates = sheet\.slice\(0, Math\.min\(20, sheet\.length\)\)/, "import must discover a header row instead of assuming row 1");
assert.match(main, /상품 번호", "상품번호", "품번"/, "import must accept current POIZON product-number aliases");
assert.match(main, /상품번호\/상품명 열을 찾지 못했습니다/, "zero-import must explain an unrecognized workbook");
assert.match(renderer, /Excel 가져오기 실패:/, "renderer must surface import failures instead of silently failing");

console.log("Excel import regression checks passed");
