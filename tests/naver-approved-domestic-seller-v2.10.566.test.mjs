import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isApprovedNaverDomesticSellerEvidence } from "../services/naver-price.mjs";

const departmentUrl = "https://shopping.naver.com/window-products/department/132434429842";

test("department-store branch sale banner is approved", () => {
  assert.equal(isApprovedNaverDomesticSellerEvidence({
    productUrl: departmentUrl,
    sellerEvidenceText: "공식 롯데백화점 대전점에서 판매중인 상품",
    detailText: "아디다스 슈퍼스타 JI0079 123,670원",
  }), true);
});

test("official seller and brand-direct banners are approved", () => {
  for (const sellerEvidenceText of [
    "상품 상세페이지 공식판매처",
    "브랜드 공식 스토어",
    "공식 휠라 왕십리점에서 판매중인 상품",
  ]) {
    assert.equal(isApprovedNaverDomesticSellerEvidence({
      productUrl: "https://shopping.naver.com/window-products/outlet/123",
      sellerEvidenceText,
      detailText: "국내 상품 89,000원",
    }), true, sellerEvidenceText);
  }
});

test("generic authenticity wording without seller proof is rejected", () => {
  for (const sellerEvidenceText of ["", "백화점정품", "매장정품 매장판", "세토프에서 판매중인 상품"]) {
    assert.equal(isApprovedNaverDomesticSellerEvidence({
      productUrl: departmentUrl,
      sellerEvidenceText,
      detailText: "정품 아디다스 슈퍼스타 123,670원",
    }), false, sellerEvidenceText);
  }
});

test("overseas and barcode-removed products are always rejected", () => {
  assert.equal(isApprovedNaverDomesticSellerEvidence({
    productUrl: "https://shopping.naver.com/window-products/foreign/135628828612",
    sellerEvidenceText: "공식 판매처 해외직구 관부가세가 포함된 상품",
    detailText: "131,000원",
  }), false);
  assert.equal(isApprovedNaverDomesticSellerEvidence({
    productUrl: departmentUrl,
    sellerEvidenceText: "공식 롯데백화점 대전점에서 판매중인 상품",
    detailText: "정품이나 QR코드 제거 후 발송",
  }), false);
});

test("Naver result and price lookup both use isolated seller-evidence filtering", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
  const patchScript = fs.readFileSync(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");
  assert.match(main, /async function filterApprovedNaverDomesticProducts/);
  assert.match(main, /const approvedCandidates = await filterApprovedNaverDomesticProducts\(candidates\)/);
  assert.match(main, /DOMESTIC_SELLER_EVIDENCE_PARTITION/);
  assert.match(main, /A single inaccessible product is omitted without affecting/);
  assert.match(patchScript, /const approval = await verifyApprovedNaverDomesticProducts/);
  assert.match(patchScript, /requireArticleIdentity/);
  assert.match(patchScript, /naver_seller_evidence_failed/);
});
