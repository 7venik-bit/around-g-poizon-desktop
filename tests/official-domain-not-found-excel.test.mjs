import assert from "node:assert/strict";
import test from "node:test";
import {
  naverOfficialStoreNotFoundRows,
  naverOfficialStoreNotFoundWorkbookData,
} from "../services/official-domain-not-found.mjs";

test("only completed Naver searches without a verified official mall enter the Excel list", () => {
  const rows = naverOfficialStoreNotFoundRows([
    { brandId: 1, brandName: "Alpha", brandKo: "알파", lastVerificationError: "CANDIDATE_NOT_FOUND", verificationAttempts: 2 },
    { brandId: 2, brandName: "Beta", brandKo: "베타", lastVerificationError: "CANDIDATE_VALIDATION_FAILED", verificationAttempts: 2 },
    { brandId: 3, brandName: "Blocked", lastVerificationError: "DISCOVERY_BLOCKED", verificationAttempts: 1 },
    { brandId: 4, brandName: "Timeout", lastVerificationError: "BRAND_AUDIT_TIMEOUT", verificationAttempts: 1 },
    { brandId: 5, brandName: "Verified", status: "verified", lastVerificationError: "" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.brandName), ["Alpha", "Beta"]);
  assert.equal(rows.every((row) => row.result === "네이버 공식몰 미발견"), true);
});

test("the official-mall not-found workbook has auditable Korean columns", () => {
  const data = naverOfficialStoreNotFoundWorkbookData(naverOfficialStoreNotFoundRows([
    { brandId: 10, brandName: "Gamma", brandKo: "감마", lastVerificationError: "CANDIDATE_NOT_FOUND", verificationAttempts: 2, lastCheckedAt: "2026-08-11T03:00:00.000Z" },
  ]));
  assert.deepEqual(data[0].map((cell) => cell.value), [
    "번호", "브랜드 ID", "POIZON 브랜드명", "한글 브랜드명", "검증 결과",
    "미발견 사유", "검증 횟수", "마지막 확인 시간", "네이버 검색 URL",
  ]);
  assert.equal(data[1][2].value, "Gamma");
  assert.equal(data[1][6].value, 2);
});
