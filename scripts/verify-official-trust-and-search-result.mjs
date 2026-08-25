import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`official-result verification failed: ${message}`); };

if (!main.includes("최종 화면을 다시 확인해 성공 여부를 판정한다")) fail("official mall rendered-result fallback is missing");
if (!main.includes("return officialMallSearchWasExecuted(searchWindow, query, previousUrl);")) fail("official mall final result verification call is missing");
if (main.includes("const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;")) fail("official mall still fails immediately on submit signal");
if (!main.includes("naverTrustedChannelEvidence: result?.naverTrustedChannelEvidence === true")) fail("Naver trusted-channel evidence is not preserved");
if (!main.includes("naverAllSearchVerdict: result?.naverAllSearchVerdict || null")) fail("Naver final verdict is not preserved");
if (!renderer.includes('const naverFashionTownConfirmed = String(source.store || "") === "네이버 패션타운"')) fail("Naver Fashion Town confirmation gate missing");
if (!renderer.includes('source.naverTrustedChannelEvidence === true')) fail("Naver trusted-channel evidence is not used by renderer");
if (!renderer.includes('if (naverFashionTownConfirmed) return { label: "확인완료", className: "available" };')) fail("Naver trusted evidence does not finish as 확인완료");
if (!renderer.includes("네이버 패션타운에서 상품코드 검색 결과와 공식 유통 채널이 확인되어 정품 유통 근거가 충분합니다.")) fail("Naver authenticity evidence detail message missing");
if (renderer.includes("재고·사이즈 판정 근거가 부족합니다.")) fail("obsolete stock-size pending wording remains");

if (!renderer.includes('const officialMallSource = String(source.store || "") === "브랜드 공식몰";')) fail("official mall binary status gate is missing");
if (!renderer.includes('if (officialResultFound) return { label: "확인완료", className: "available" };')) fail("official mall success label is not 확인완료");
if (!renderer.includes('if (officialResultMissing) return { label: "상품없음", className: "missing" };')) fail("official mall absence label is not 상품없음");
if (!renderer.includes('source.searchCompleted === true && Number(source.count || 0) > 0')) fail("official mall rendered result count is not accepted as success");
if (!renderer.includes('Number(source.candidateCount || 0) === 0')) fail("official mall completed empty result is not accepted as absence");
if (!renderer.includes("브랜드 공식몰 검색 결과에서 상품을 확인했습니다.")) fail("official mall success detail is missing");
if (!renderer.includes("브랜드 공식몰 검색 결과에 상품이 없습니다.")) fail("official mall absence detail is missing");
if (renderer.includes("검색 입력 실패")) fail("forbidden search-input-failure wording remains");
if (!renderer.includes("검색 결과 확인")) fail("replacement neutral search-result status is missing");

if (!main.includes('const verifyMusinsaInventory = String(source.store || "") === "무신사";')) fail("Musinsa inventory gate missing");
if (!main.includes('if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);')) fail("size option check is not Musinsa-only");
if (!renderer.includes('if (!musinsaSource && matchedProducts.length) return { label: "상품 확인됨"')) fail("non-Musinsa source still depends on inventory state");
if (!renderer.includes('return { label: "상품 확인", className: "available" };')) fail("overall domestic result still requires inventory state");
if (!renderer.includes("무신사 재고만 보기")) fail("inventory-only UI is not labelled Musinsa-only");

console.log("Naver Fashion Town authenticity wording and official mall binary verdict verified");
