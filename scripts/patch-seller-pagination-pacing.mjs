import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Seller pagination patch target not found (${label}): ${before.slice(0, 120)}`);
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "const sellerPageDelayMs = 7_000;",
  "const sellerPageDelayMs = 12_000;",
  "page delay",
);
replaceOnce(
  "const sellerBatchPauseMs = 30_000;",
  "const sellerBatchPauseMs = 45_000;",
  "batch pause",
);
replaceOnce(
  "const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds",
  "const sellerPageResponseAttempts = 360; // 360 × 250ms = 90 seconds",
  "response wait",
);
replaceOnce(
  "서버 보호를 위해 30초 휴식 중",
  "서버 보호를 위해 45초 휴식 중",
  "progress pause message",
);
replaceOnce(
  "다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다.",
  "다음 페이지를 90초씩 재시도했지만 응답하지 않았습니다.",
  "failure wait message",
);
replaceOnce(
  "  const sellerPageSettleMs = 5_000;\n",
  "  const sellerPageSettleMs = 10_000;\n",
  "post-navigation settle",
);
replaceOnce(
  "  const deadline = Date.now() + 15_000;\n  let previousSignature = \"\";\n  let stableSamples = 0;",
  "  const deadline = Date.now() + 30_000;\n  let previousSignature = \"\";\n  let stableSamples = 0;",
  "naver result stability deadline",
);

if (changed) {
  await writeFile(mainPath, source, "utf8");
  console.log("Applied safer Seller Center pagination pacing and longer search stabilization waits.");
} else {
  console.log("Seller Center pagination pacing and search stabilization already patched.");
}
