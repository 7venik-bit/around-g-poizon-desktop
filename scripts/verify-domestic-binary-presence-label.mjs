import { readFile } from "node:fs/promises";

const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`domestic binary presence verification failed: ${message}`); };

if (!sourcing.includes("data-around-g-domestic-binary-presence")) fail("binary presence marker missing");
if (!sourcing.includes('label: "상품 있음"')) fail("상품 있음 label missing");
if (!sourcing.includes('label: "상품 없음"')) fail("상품 없음 label missing");
if (!sourcing.includes('class="sourcing-product-present">상품 있음</span>')) fail("recognized product row badge missing");
if (!sourcing.includes('present ? "상품 링크" : "판매처 열기"')) fail("product-link action missing");
if (sourcing.includes('label: "확인 필요"')) fail("확인 필요 status still remains");
if (sourcing.includes('검색 결과 확인이 완료되지 않았습니다.')) fail("legacy incomplete-result copy still remains");
if (sourcing.includes('판매처에서 직접 확인이 필요합니다.')) fail("legacy manual-review copy still remains");

console.log("domestic binary presence labels verified: 상품 있음 / 상품 없음 only after search");
