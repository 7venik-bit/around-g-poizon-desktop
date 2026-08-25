import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`official-result verification failed: ${message}`); };

if (!main.includes("최종 화면을 다시 확인해 성공 여부를 판정한다")) fail("official mall rendered-result fallback is missing");
if (!main.includes("return officialMallSearchWasExecuted(searchWindow, query, previousUrl);")) fail("official mall final result verification call is missing");
if (main.includes("const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;")) fail("official mall still fails immediately on submit signal");

if (!main.includes("고정 정책: 네이버 패션타운은 상품 카드의 판매처 유형 라벨만 본다")) fail("Naver label-only policy marker missing");
if (!main.includes('const labels = ["브랜드직영몰", "백화점", "아울렛"]')) fail("trusted seller-type labels missing");
if (!main.includes('for (let attempt = 0; attempt < 8 && trustedChannelLabels.length === 0; attempt += 1)')) fail("Naver seller-label polling is missing");
if (!main.includes('const queryCode = ${JSON.stringify(String(articleNumber || "").trim().toUpperCase())}')) fail("Naver product-card query-code anchor is missing");
if (!main.includes('const hasImage = Boolean(node.querySelector?.("img"));')) fail("Naver product-card image anchor is missing");
if (!main.includes('const hasPrice = /\\d{1,3}(?:,\\d{3})+\\s*원/.test(text);')) fail("Naver product-card price anchor is missing");
if (!main.includes('if (hasImage && hasPrice && hasCode) return true;')) fail("Naver seller label is not tied to rendered product card evidence");
if (!main.includes('/^(브랜드직영몰|백화점|아울렛)\\s*\\d+\\s*개$/')) fail("top channel-count tabs are not excluded");
if (!main.includes("const confirmed = trustedChannelEvidence;")) fail("Naver verdict still uses product-card matching or other evidence");
if (!main.includes("absenceConfirmed: !trustedChannelEvidence")) fail("missing trusted seller label does not become absence");
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : "absent"')) fail("Naver verdict is not strictly binary");
if (!main.includes("naverTrustedChannelLabels: trustedChannelLabels")) fail("detected trusted seller labels are not returned");
if (!main.includes("naverTrustedChannelEvidence: result?.naverTrustedChannelEvidence === true")) fail("Naver trusted-channel evidence is not preserved");
if (!main.includes("naverTrustedChannelLabels: Array.isArray(result?.naverTrustedChannelLabels)")) fail("Naver trusted seller labels are not preserved");

if (!renderer.includes('if (String(source.store || "") === "네이버 패션타운")')) fail("Naver Fashion Town status gate missing");
if (!renderer.includes('if (source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed") return { label: "확인완료", className: "available" };')) fail("trusted seller label does not finish as 확인완료");
if (!renderer.includes('return { label: "상품없음", className: "missing" };')) fail("missing trusted seller label does not finish as 상품없음");
if (!renderer.includes("네이버 패션타운 판매처 유형에서 브랜드직영몰·백화점·아울렛 중 하나를 확인하여 정품 유통 근거가 충분합니다.")) fail("Naver confirmed detail wording missing");
if (!renderer.includes("네이버 패션타운 판매처 유형에 브랜드직영몰·백화점·아울렛이 없어 상품없음으로 판정했습니다.")) fail("Naver absent detail wording missing");
if (renderer.includes('source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length')) fail("Naver still uses matched products as a verdict shortcut");
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

console.log("Naver Fashion Town rendered-card label verdict and official mall binary verdict verified");
