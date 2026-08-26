import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`official-result verification failed: ${message}`); };

if (!main.includes("최종 화면을 다시 확인해 성공 여부를 판정한다")) fail("official mall rendered-result fallback is missing");
if (!main.includes("return officialMallSearchWasExecuted(searchWindow, query, previousUrl);")) fail("official mall final result verification call is missing");
if (main.includes("const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;")) fail("official mall still fails immediately on submit signal");

if (!main.includes('import { evaluateDomesticProductCards } from "./services/domestic-card-verdict.mjs";')) fail("shared card verdict engine is not imported into main");
if (!main.includes("공통 카드 판정 엔진")) fail("shared card verdict policy marker missing");
if (!main.includes('for (let attempt = 0; attempt < 10 && !cardVerdict.trusted; attempt += 1)')) fail("rendered product-card polling is missing");
if (!main.includes('const hasImage = Boolean(node.querySelector?.("img"));')) fail("product-card image anchor is missing");
if (!main.includes('const hasPrice = /\\d{1,3}(?:,\\d{3})+\\s*원/.test(text);')) fail("product-card price anchor is missing");
if (!main.includes('const hasCode = !queryCode || text.toUpperCase().includes(queryCode);')) fail("product-card exact-code anchor is missing");
if (!main.includes('cardVerdict = evaluateDomesticProductCards({')) fail("Naver does not call the shared card verdict engine");
if (!main.includes('store: "네이버 패션타운"')) fail("Naver platform identity is not passed to shared engine");
if (!main.includes('articleNumber,')) fail("exact article number is not passed to shared engine");
if (!main.includes("const confirmed = naverVisibleResultCount > 0 || allProducts.length > 0 || trustedChannelEvidence")) fail("visible matching product count and cards are not preserved");
if (!main.includes("absenceConfirmed: explicitEmpty && !confirmed")) fail("Naver can report absence without an explicit empty state");
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending")')) fail("Naver verdict does not preserve uncertain UI states");
if (!main.includes("naverTrustedChannelLabels: trustedChannelLabels")) fail("detected trusted seller labels are not returned");
if (!main.includes("let renderedProductCards = []")) fail("actual Naver result cards are not retained for display");
if (!main.includes("let naverVisibleResultCount = 0")) fail("Naver visible total count is not retained");
if (!main.includes('store: "네이버 패션타운",\n          sourceStore: "네이버 패션타운"')) fail("Naver result cards are not mapped to renderer products");
if (!main.includes("imageVerifiedFromCard: Boolean(card.imageUrl)")) fail("Naver product images are not preserved");
if (!main.includes("analyzedProducts.length ? analyzedProducts : cardProducts")) fail("Naver display-card fallback is missing");
if (!main.includes("const exactQueryPage = compactCode(new URLSearchParams(location.search).get(\"q\")) === compactCode(queryCode)")) fail("exact Fashion Town query-page recognition is missing");
if (!main.includes("exactQueryPage && productLink")) fail("Naver cards still require all fields inside one DOM node");
if (!main.includes(".slice(0, 8)")) fail("Naver visible product list is not bounded");
if (!main.includes("const totalMatch = bodyText.match(/(?:^|\\s)전체\\s*([0-9,]+)\\s*개/)")) fail("Naver 전체 N개 result count is not parsed");
if (!main.includes("exactQueryPage && productLink")) fail("split Naver cards are not accepted by exact-query product links");
if (!main.includes("naverVisibleResultCount > 0 || allProducts.length > 0")) fail("visible Naver result count does not prevent a false absence verdict");
if (!main.includes("count: Math.max(naverVisibleResultCount, allProducts.length)")) fail("visible Naver result count is not returned to renderer");

if (!renderer.includes('if (String(source.store || "") === "네이버 패션타운")')) fail("Naver Fashion Town status gate missing");
if (!renderer.includes('source.presenceConfirmed === true || source.naverTrustedChannelEvidence === true')) fail("visible product result does not finish as 확인완료");
if (!renderer.includes('return { label: "상품없음", className: "missing" };')) fail("missing trusted seller label does not finish as 상품없음");
if (!renderer.includes("정확 상품 카드에서 브랜드직영몰·백화점·아울렛 판매처 유형을 확인하여 정품 유통 근거가 충분합니다.")) fail("shared-card confirmed wording missing");
if (!renderer.includes("패션타운 검색 결과에 일치 상품이 없습니다.")) fail("explicit empty-result wording missing");
if (!renderer.includes('return { label: "결과 확인 중", className: "pending" };')) fail("uncertain Naver state is incorrectly reported as absent");
if (renderer.includes("재고·사이즈 판정 근거가 부족합니다.")) fail("obsolete stock-size pending wording remains");

if (!renderer.includes('const officialMallSource = String(source.store || "") === "브랜드 공식몰";')) fail("official mall binary status gate is missing");
if (!renderer.includes('if (officialResultFound) return { label: "확인완료", className: "available" };')) fail("official mall success label is not 확인완료");
if (!renderer.includes('if (officialResultMissing) return { label: "상품없음", className: "missing" };')) fail("official mall absence label is not 상품없음");
if (renderer.includes("검색 입력 실패")) fail("forbidden search-input-failure wording remains");

if (!main.includes('const verifyMusinsaInventory = String(source.store || "") === "무신사";')) fail("Musinsa inventory gate missing");
if (!main.includes('if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);')) fail("size option check is not Musinsa-only");
if (!renderer.includes("무신사 재고만 보기")) fail("inventory-only UI is not labelled Musinsa-only");

console.log("Shared exact product-card verdict engine and official mall binary verdict verified");
