import test from "node:test";
import assert from "node:assert/strict";
import { assertPoizonPageReadyForCorrection } from "../services/live-poizon-crosscheck.mjs";

const product = (spuId, articleNumber) => ({ spuId, articleNumber, name: `product ${spuId}` });
const row = (spuId, articleNumber) => ({
  spuId,
  articleNumber,
  status: "상품 인식 완료 · 판매량 일치 · 수정 없음",
});

test("a count mismatch reports both counts and the missing identity", () => {
  const products = [product("111", "A-1"), product("222", "B-2")];
  const rows = [row("111", "A-1")];
  assert.throws(
    () => assertPoizonPageReadyForCorrection(products, rows, 3),
    (error) => {
      assert.match(error.message, /페이지 상품 수와 대조 증거 수가 달라 Excel 수정을 중단했습니다/);
      assert.match(error.message, /POIZON 3페이지 상품 2개·대조 증거 1개/);
      assert.match(error.message, /증거 없음: SPU:222/);
      return true;
    },
  );
});

test("surplus evidence is reported the same way", () => {
  const products = [product("111", "A-1")];
  const rows = [row("111", "A-1"), row("333", "C-3")];
  assert.throws(
    () => assertPoizonPageReadyForCorrection(products, rows, 1),
    (error) => {
      assert.match(error.message, /상품 1개·대조 증거 2개/);
      assert.match(error.message, /여분 증거: SPU:333/);
      return true;
    },
  );
});

test("an empty page still stops without diagnostics to invent", () => {
  assert.throws(
    () => assertPoizonPageReadyForCorrection([], [], 2),
    /페이지 상품 수와 대조 증거 수가 달라 Excel 수정을 중단했습니다\. \(POIZON 2페이지 상품 0개·대조 증거 0개\)/,
  );
});

test("matching evidence still passes and stays verifiable", () => {
  const products = [product("111", "A-1"), product("222", "B-2")];
  const rows = [row("222", "B-2"), row("111", "A-1")];
  const writable = assertPoizonPageReadyForCorrection(products, rows, 3);
  assert.equal(writable.length, 2);
  assert.equal(writable.pageEvidence.verified, true);
  assert.equal(writable.pageEvidence.sourceProducts, 2);
});
