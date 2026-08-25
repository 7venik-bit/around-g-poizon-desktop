import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`official-result verification failed: ${message}`); };

if (!main.includes("최종 화면을 다시 확인해 성공 여부를 판정한다")) {
  fail("official mall rendered-result fallback is missing");
}
if (!main.includes("return officialMallSearchWasExecuted(searchWindow, query, previousUrl);")) {
  fail("official mall final result verification call is missing");
}
if (main.includes("const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;")) {
  fail("official mall still fails immediately on submit signal");
}
if (!main.includes("naverChannelCounts: result?.naverChannelCounts || null")) {
  fail("Naver channel counts are not preserved in source result");
}
if (!renderer.includes("브랜드직영몰 · 정품 신뢰도 100%")) {
  fail("brand-direct 100% trust label is missing");
}
if (!renderer.includes("브랜드직영몰 확인 · 정품 신뢰도 100% · 상품 확인됨")) {
  fail("brand-direct detail message is missing");
}
if (!renderer.includes('Number(source?.naverChannelCounts?.["네이버 공식 브랜드스토어"] || 0) > 0')) {
  fail("brand-direct evidence is not tied to Naver official-brand-store count");
}
if (renderer.includes("재고·사이즈 판정 근거가 부족합니다.")) {
  fail("obsolete stock-size pending wording remains");
}

console.log("official trust wording and official-mall result recognition verification passed");
