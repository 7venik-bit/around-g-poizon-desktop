import test from "node:test";
import assert from "node:assert/strict";
import { domesticDetailProgressStatus } from "../relay/domestic-search.mjs";

test("detail progress separates confirmed sold-out products from unresolved detail checks", () => {
  const label = domesticDetailProgressStatus({
    products: [
      { inStock: false, stockText: "SOLD OUT" },
      { inStock: false, stockText: "재고 없음" },
      { inStock: true },
    ],
    failedDetails: 3,
  });
  assert.equal(label, "품절·재고 없음 2건 · 상세 확인 필요 3건");
  assert.doesNotMatch(label, /응답 실패/);
});

test("detail progress never turns a technical detail error into product absence or sold out", () => {
  assert.equal(domesticDetailProgressStatus({failedDetails: 5}), "상세 확인 필요 5건");
  assert.equal(domesticDetailProgressStatus({failedDetails: 0}), "");
});

test("detail progress uses checkpoint products when an update only carries counters", () => {
  assert.equal(domesticDetailProgressStatus({failedDetails: 0}, [{inStock:false}]), "품절·재고 없음 1건");
});
