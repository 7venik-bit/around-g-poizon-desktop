import test from "node:test";
import assert from "node:assert/strict";
import {
  domesticProductIdentityAccepted,
  scoreProductCandidate,
} from "../services/matcher.mjs";

const source = {
  articleNumber: "SR123UPS11",
  brand: "데상트",
  title: "데상트 남성 카라 반팔 티셔츠",
};

test("image + product name can confirm a product without marketplace code matching", () => {
  const scored = {
    id: "LOTTE-STORE-998877",
    store: "롯데온",
    brand: "데상트",
    title: "데상트 남성 카라 반팔 티셔츠",
    detectedArticleNumber: "",
    articleConflict: false,
    ...scoreProductCandidate(source, {
      id: "LOTTE-STORE-998877",
      store: "롯데온",
      brand: "데상트",
      title: "데상트 남성 카라 반팔 티셔츠",
      detectedArticleNumber: "",
      articleConflict: false,
    }, 0.92),
  };

  assert.equal(scored.signals.codeScore, 0);
  assert.equal(scored.signals.codeConflict, false);
  assert.ok(!scored.signals.detectedCodes.includes("LOTTESTORE998877"));
  assert.equal(domesticProductIdentityAccepted(scored, { hasSourceImage: true }), true);
});

test("an explicit conflicting manufacturer article rejects even a strong visual match", () => {
  const candidate = {
    store: "SSG",
    brand: "데상트",
    title: "데상트 남성 카라 반팔 티셔츠 ZZ999ABC88",
    detectedArticleNumber: "ZZ999ABC88",
    articleConflict: true,
  };
  const scored = { ...candidate, ...scoreProductCandidate(source, candidate, 0.96) };
  assert.equal(domesticProductIdentityAccepted(scored, { hasSourceImage: true }), false);
});

test("matching manufacturer code cannot rescue a wrong image and wrong product name", () => {
  const candidate = {
    store: "네이버 공식 브랜드스토어",
    brand: "데상트",
    title: "데상트 여성 러닝화 SR123UPS11",
    detectedArticleNumber: "SR123UPS11",
    articleConflict: false,
  };
  const scored = { ...candidate, ...scoreProductCandidate(source, candidate, 0.31) };
  assert.equal(scored.signals.codeScore, 1);
  assert.equal(domesticProductIdentityAccepted(scored, { hasSourceImage: true }), false);
});

test("when image comparison is unavailable, exact manufacturer code plus very strong title is required", () => {
  const candidate = {
    store: "SSG",
    brand: "데상트",
    title: "데상트 남성 카라 반팔 티셔츠 SR123UPS11",
    detectedArticleNumber: "SR123UPS11",
    articleConflict: false,
    brandVerifiedFromCard: true,
  };
  const scored = { ...candidate, ...scoreProductCandidate(source, candidate, null) };
  assert.equal(scored.signals.codeScore, 1);
  assert.equal(domesticProductIdentityAccepted(scored, { hasSourceImage: true }), true);
});
