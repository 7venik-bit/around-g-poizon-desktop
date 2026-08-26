import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDomesticProductCard,
  evaluateDomesticProductCards,
  trustedAccountSheetRetailer,
} from "../services/domestic-card-verdict.mjs";

test("Drive account-sheet trusted retailers are recognized from exact product cards", () => {
  const cases = [
    ["병행수입·편집샵", "SR123UPS11", "ABC마트 SR123UPS11 57,950원", "ABC마트"],
    ["무신사", "JI0079", "무신사 슈퍼스타 JI0079 149,000원", "무신사"],
    ["29CM", "B75806", "29CM 아디다스 B75806 149,000원", "29CM"],
    ["병행수입·편집샵", "B75806", "S.I.VILLAGE 아디다스 B75806 149,000원", "S.I.VILLAGE"],
    ["SSG", "B75806", "신세계백화점 아디다스 B75806 149,000원", "신세계백화점"],
    ["롯데온", "B75806", "롯데백화점 아디다스 B75806 149,000원", "롯데백화점"],
  ];
  for (const [store, articleNumber, text, expectedRetailer] of cases) {
    const result = evaluateDomesticProductCard({ store, articleNumber, text });
    assert.equal(result.trusted, true, `${expectedRetailer} should be trusted`);
    assert.equal(result.accountSheetRetailer, expectedRetailer);
    assert.equal(result.accountSheetEvidence, true);
  }
});

test("trusted source name alone is insufficient without exact product code", () => {
  const result = evaluateDomesticProductCard({
    store: "병행수입·편집샵",
    articleNumber: "SR123UPS11",
    text: "ABC마트 다른 상품 AB9999 57,950원",
  });
  assert.equal(result.trusted, false);
  assert.equal(result.codeMatched, false);
});

test("parallel import wording overrides trusted retailer evidence", () => {
  const result = evaluateDomesticProductCard({
    store: "SSG",
    articleNumber: "B75806",
    text: "신세계백화점 B75806 병행수입 120,000원",
  });
  assert.equal(result.trusted, false);
  assert.equal(result.parallelImport, true);
});

test("Naver Fashion Town still accepts exact-card official distribution labels", () => {
  const result = evaluateDomesticProductCards({
    store: "네이버 패션타운",
    articleNumber: "JI0079",
    cards: [{ text: "아디다스 브랜드직영몰 슈퍼스타 JI0079 149,000원" }],
  });
  assert.equal(result.trusted, true);
  assert.equal(result.platformLabelEvidence, true);
});

test("account sheet retailer lookup uses non-sensitive retailer names only", () => {
  assert.equal(trustedAccountSheetRetailer("", "롯데백화점 B75806")?.label, "롯데백화점");
  assert.equal(trustedAccountSheetRetailer("", "신세계 아울렛 B75806")?.label, "신세계 아울렛");
});
