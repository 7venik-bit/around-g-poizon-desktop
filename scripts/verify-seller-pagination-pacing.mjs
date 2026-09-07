import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const required = [
  "const sellerPageDelayMs = 12_000;",
  "const sellerBatchPauseEvery = 10;",
  "const sellerBatchPauseMs = 45_000;",
  "const sellerPageResponseAttempts = 360; // 360 × 250ms = 90 seconds",
  "const sellerPageSettleMs = 10_000;",
  "서버 보호를 위해 45초 휴식 중",
  "pageSize,",
  "expectedRowCount: expectedNextRowCount",
  "rows.length >= Math.max(1, ${expectedNextRowCount})",
  "await wait(sellerPageSettleMs);",
  "code: reachedLastPage ? \"SELLER_ROW_COUNT_INCOMPLETE\" : \"SELLER_PAGINATION_INCOMPLETE\"",
  "페이지까지 모두 확인했지만 화면 상품을",
  "다음 페이지를 90초씩 재시도했지만 응답하지 않았습니다.",
];

for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`Seller pagination pacing verification failed: ${value}`);
  }
}

const forbidden = [
  "const sellerPageDelayMs = 2_500;",
  "const sellerPageDelayMs = 7_000;",
  "const sellerBatchPauseMs = 10_000;",
  "const sellerBatchPauseMs = 30_000;",
  "const sellerPageResponseAttempts = 120; // 120 × 250ms = 30 seconds",
  "const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds",
  "const sellerPageSettleMs = 5_000;",
  "서버 보호를 위해 10초 휴식 중",
  "서버 보호를 위해 30초 휴식 중",
  "다음 페이지를 30초씩 재시도했지만 응답하지 않았습니다.",
  "다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다.",
];

for (const value of forbidden) {
  if (source.includes(value)) {
    throw new Error(`Old Seller pagination pacing remains: ${value}`);
  }
}

console.log("Seller Center pagination verified: 12s/page, 45s/10 pages, 90s response wait, 10s settle, full-row readiness.");
