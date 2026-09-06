import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const required = [
  "const sellerPageDelayMs = 7_000;",
  "const sellerBatchPauseEvery = 10;",
  "const sellerBatchPauseMs = 30_000;",
  "const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds",
  "서버 보호를 위해 30초 휴식 중",
  "다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다.",
];

for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`Seller pagination pacing verification failed: ${value}`);
  }
}

const forbidden = [
  "const sellerPageDelayMs = 2_500;",
  "const sellerBatchPauseMs = 10_000;",
  "const sellerPageResponseAttempts = 120; // 120 × 250ms = 30 seconds",
  "서버 보호를 위해 10초 휴식 중",
  "다음 페이지를 30초씩 재시도했지만 응답하지 않았습니다.",
];

for (const value of forbidden) {
  if (source.includes(value)) {
    throw new Error(`Old Seller pagination pacing remains: ${value}`);
  }
}

console.log("Seller Center pagination pacing verified: 7s/page, 30s/10 pages, 60s response wait.");
