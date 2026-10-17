import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function domesticStatusBlock() {
  const start = renderer.indexOf("function domesticStatus(result) {");
  assert.notEqual(start, -1);
  const end = renderer.indexOf("function hasDomesticStock(", start);
  assert.notEqual(end, -1);
  return renderer.slice(start, end);
}

function fallbackButtonBlock() {
  const start = renderer.indexOf("const status = result?.loading ?");
  assert.notEqual(start, -1);
  return renderer.slice(start, start + 700);
}

test("fallback status labels use popular-list values", () => {
  const fn = domesticStatusBlock();
  assert.match(fn, /label: `결과 \$\{verifiedCount\.toLocaleString\("ko-KR"\)\}개`, className: "available"/);
  assert.match(fn, /label: "확인 필요", className: "pending"/);
  assert.match(fn, /label: "-", className: "missing"/);
  assert.match(fn, /label: `상품 \$\{products\.length\.toLocaleString\("ko-KR"\)\}개`, className: "soldout"/);
  assert.match(fn, /label: `상품 \$\{products\.length\.toLocaleString\("ko-KR"\)\}개`, className: "available"/);
  assert.doesNotMatch(fn, /판매처 발견|없음 확인|구매 가능|추가 확인 필요/);
});

test("fallback row buttons use popular-list values", () => {
  const button = fallbackButtonBlock();
  assert.match(button, /`상품 \$\{\(result\.products \|\| \[\]\)\.length\.toLocaleString\("ko-KR"\)\}개`/);
  assert.match(button, /\? "확인 필요"/);
  assert.match(button, /: "-"/);
  assert.doesNotMatch(button, /개 상품 있음|국내 상품 없음/);
});
