import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isParallelImportProductDetail } from "../relay/domestic-search.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

test("mandatory product information declaring parallel import is excluded", () => {
  const detail = [
    "상품필수정보",
    "제조사/원산지 ADIDAS/상품상세 참조",
    "모델번호 JH9976",
    "제조자, 수입자 ADIDAS/병행수입, 한아이엔티",
    "A/S책임자와 전화번호 [해외직수입품A/S불가 1544-0980]",
  ].join("\n");
  assert.equal(isParallelImportProductDetail(detail), true);
});

test("genuine detail pages without the declaration are kept", () => {
  assert.equal(isParallelImportProductDetail("신세계백화점 나이키 덩크 로우 DD1503-101 89,400원"), false);
  assert.equal(isParallelImportProductDetail(""), false);
  assert.equal(isParallelImportProductDetail("불법 상품 및 부적격 상품 판매 또는 허위과장광고 등 문제가 있는 경우 신고하여 주시기 바랍니다. 병행수입 상품 신고하기"), false);
});

test("explicit non-parallel statements are not treated as parallel import", () => {
  assert.equal(isParallelImportProductDetail("제조자 삼성물산 병행수입이 아닙니다. 정식통관 제품입니다."), false);
});

test("lotte detail loop drops parallel-import declarations", () => {
  const start = main.indexOf("async function renderedSearchSourceResult(");
  const end = main.indexOf("async function renderedSearchFailure(", start);
  const collection = main.slice(start, end);
  assert.match(collection, /isParallelImportProductDetail\(evidence\)/);
  const line = collection.slice(
    collection.indexOf("isParallelImportProductDetail(evidence)") - 200,
    collection.indexOf("isParallelImportProductDetail(evidence)"),
  );
  assert.match(line, /\^롯데온/);
});
