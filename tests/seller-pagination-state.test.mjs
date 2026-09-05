import test from "node:test";
import assert from "node:assert/strict";
import {
  sellerPaginationTransitionStatus,
  sellerRowsSignature,
} from "../services/seller-pagination-state.mjs";

test("페이지 번호와 전체 상품 행이 갱신되면 정상 전환으로 판정한다", () => {
  const previous = sellerRowsSignature(["상품 A", "상품 B", "상품 Z"]);
  const current = sellerRowsSignature(["상품 A", "상품 C", "상품 Z"]);
  assert.notEqual(current, previous, "첫 행과 마지막 행이 같아도 중간 상품 변경을 감지해야 한다");
  assert.deepEqual(sellerPaginationTransitionStatus({
    expectedPage: 7,
    currentPage: 7,
    rowCount: 3,
    previousSignature: previous,
    currentSignature: current,
  }), { ready: true, reason: "PAGE_READY" });
});

test("페이지 번호만 바뀌고 행이 로딩 중이면 기다린다", () => {
  const signature = sellerRowsSignature(["상품 A", "상품 B"]);
  assert.equal(sellerPaginationTransitionStatus({
    expectedPage: 7,
    currentPage: 7,
    rowCount: 2,
    previousSignature: signature,
    currentSignature: signature,
  }).reason, "ROW_UPDATE_PENDING");
});

test("행이 바뀌어도 활성 페이지가 이전 번호면 기다린다", () => {
  assert.equal(sellerPaginationTransitionStatus({
    expectedPage: 7,
    currentPage: 6,
    rowCount: 20,
    previousSignature: "old",
    currentSignature: "new",
  }).reason, "ACTIVE_PAGE_PENDING");
});

test("빈 상품표는 완료로 오인하지 않는다", () => {
  assert.equal(sellerPaginationTransitionStatus({
    expectedPage: 7,
    currentPage: 7,
    rowCount: 0,
    previousSignature: "old",
    currentSignature: "",
  }).reason, "ROWS_PENDING");
});

test("150페이지 수집 중 6·40페이지 지연과 동일한 양끝 상품을 통과한다", () => {
  let completed = 1;
  let previousRows = ["공통 첫 상품", "1페이지 상품", "공통 마지막 상품"];
  for (let expectedPage = 2; expectedPage <= 150; expectedPage += 1) {
    const previousSignature = sellerRowsSignature(previousRows);
    const currentRows = ["공통 첫 상품", `${expectedPage}페이지 고유 상품`, "공통 마지막 상품"];
    const currentSignature = sellerRowsSignature(currentRows);
    const stalePolls = expectedPage === 6 ? 25 : expectedPage === 40 ? 80 : 2;
    for (let poll = 0; poll < stalePolls; poll += 1) {
      assert.equal(sellerPaginationTransitionStatus({
        expectedPage,
        currentPage: expectedPage,
        rowCount: previousRows.length,
        previousSignature,
        currentSignature: previousSignature,
      }).ready, false);
    }
    assert.equal(sellerPaginationTransitionStatus({
      expectedPage,
      currentPage: expectedPage,
      rowCount: currentRows.length,
      previousSignature,
      currentSignature,
    }).ready, true);
    previousRows = currentRows;
    completed = expectedPage;
  }
  assert.equal(completed, 150);
});
