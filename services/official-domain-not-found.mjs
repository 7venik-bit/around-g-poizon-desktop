const NAVER_NOT_FOUND_ERRORS = new Set([
  "CANDIDATE_NOT_FOUND",
  "CANDIDATE_VALIDATION_FAILED",
]);

const reasonLabel = (errorCode) => ({
  CANDIDATE_NOT_FOUND: "네이버 검색 결과에서 공식몰 후보를 찾지 못함",
  CANDIDATE_VALIDATION_FAILED: "검색 후보는 있으나 공식몰로 확인할 근거가 부족함",
}[String(errorCode || "")] || "공식몰 미발견");

export function naverOfficialStoreNotFoundRows(registry) {
  return (Array.isArray(registry) ? registry : [])
    .filter((record) => NAVER_NOT_FOUND_ERRORS.has(String(record?.lastVerificationError || "")))
    .map((record, index) => ({
      number: index + 1,
      brandId: Number(record?.brandId || 0) || "",
      brandName: String(record?.brandName || ""),
      brandKo: String(record?.brandKo || ""),
      result: "네이버 공식몰 미발견",
      reason: reasonLabel(record?.lastVerificationError),
      attempts: Number(record?.verificationAttempts || 0),
      lastCheckedAt: String(record?.lastCheckedAt || ""),
      naverSearchUrl: String(record?.candidateUrl || ""),
    }));
}

export function naverOfficialStoreNotFoundWorkbookData(rows) {
  const headers = [
    "번호", "브랜드 ID", "POIZON 브랜드명", "한글 브랜드명", "검증 결과",
    "미발견 사유", "검증 횟수", "마지막 확인 시간", "네이버 검색 URL",
  ];
  const header = headers.map((value) => ({
    value,
    fontWeight: "bold",
    backgroundColor: "#DDEBF7",
  }));
  const data = (Array.isArray(rows) ? rows : []).map((row) => [
    { value: row.number, type: Number },
    { value: row.brandId },
    { value: row.brandName },
    { value: row.brandKo },
    { value: row.result },
    { value: row.reason },
    { value: row.attempts, type: Number },
    { value: row.lastCheckedAt },
    { value: row.naverSearchUrl },
  ]);
  return [header, ...data];
}
