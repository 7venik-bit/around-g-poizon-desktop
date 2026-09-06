import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");

const replacements = [
  [
    "const sellerPageDelayMs = 2_500;",
    "const sellerPageDelayMs = 7_000;",
  ],
  [
    "const sellerBatchPauseMs = 10_000;",
    "const sellerBatchPauseMs = 30_000;",
  ],
  [
    "const sellerPageResponseAttempts = 120; // 120 × 250ms = 30 seconds",
    "const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds",
  ],
  [
    "서버 보호를 위해 10초 휴식 중",
    "서버 보호를 위해 30초 휴식 중",
  ],
  [
    "다음 페이지를 30초씩 재시도했지만 응답하지 않았습니다.",
    "다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다.",
  ],
];

let changed = false;
for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) {
    throw new Error(`Seller pagination pacing patch target not found: ${before}`);
  }
  source = source.replace(before, after);
  changed = true;
}

if (changed) {
  await writeFile(mainPath, source, "utf8");
  console.log("Applied slower Seller Center pagination pacing.");
} else {
  console.log("Seller Center pagination pacing already patched.");
}
