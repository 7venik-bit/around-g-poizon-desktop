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
if (!main.includes("const confirmed = allProducts.length > 0")) fail("Naver product list does not directly control presence");
if (!main.includes("absenceConfirmed: naverExplicitlyEmpty && !confirmed")) fail("Naver explicit zero does not finish as absence");
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : "absent"')) fail("Naver verdict still has an intermediate state");
if (!main.includes("naverTrustedChannelLabels: trustedChannelLabels")) fail("detected trusted seller labels are not returned");
if (!main.includes("let renderedProductCards = []")) fail("actual Naver result cards are not retained for display");
if (!main.includes("let naverVisibleResultCount = 0")) fail("Naver visible total count is not retained");
if (!main.includes("let naverVisibleResultCountObserved = false")) fail("observed zero and unread result count are not distinguished");
if (!main.includes('store: "네이버 패션타운",\n          sourceStore: "네이버 패션타운"')) fail("Naver result cards are not mapped to renderer products");
if (!main.includes("imageVerifiedFromCard: Boolean(card.imageUrl)")) fail("Naver product images are not preserved");
if (!main.includes("cardProducts.length ? cardProducts : analyzedProducts")) fail("Naver rendered cards are not authoritative");
if (!main.includes('for (const anchor of document.querySelectorAll("a[href]"))')) fail("Naver product anchors are not copied directly");
if (!main.includes("compactCode(text).includes(compactCode(queryCode))")) fail("Naver visible exact-code cards behind tracking links are not copied");
if (!main.includes("depth < 9") || !main.includes("candidateText")) fail("Naver sibling image, title and price blocks are not joined into one visible card");
if (!main.includes("const naverExplicitlyEmpty = allProducts.length === 0")) fail("empty Naver product list is not treated as absence");
if (!main.includes("absenceConfirmed: naverExplicitlyEmpty && !confirmed")) fail("explicit Naver zero does not produce absence");
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : "absent"')) fail("empty Naver list does not produce an absent verdict");
if (!main.includes("const exactQueryPage = compactCode(new URLSearchParams(location.search).get(\"q\")) === compactCode(queryCode)")) fail("exact Fashion Town query-page recognition is missing");
if (!main.includes("exactQueryPage && productLink")) fail("Naver cards still require all fields inside one DOM node");
if (!main.includes(".slice(0, 8)")) fail("Naver visible product list is not bounded");
if (!main.includes("const totalMatch = bodyText.match(/(?:^|\\s)전체\\s*([0-9,]+)\\s*개/)")) fail("Naver 전체 N개 result count is not parsed");
if (!main.includes("exactQueryPage && productLink")) fail("split Naver cards are not accepted by exact-query product links");
if (!main.includes("const confirmed = allProducts.length > 0")) fail("rendered Naver products do not control the verdict");
if (!main.includes("count: Math.max(naverVisibleResultCount, allProducts.length)")) fail("visible Naver result count is not returned to renderer");

if (renderer.includes('return { label: "결과 확인 중", className: "pending" };')) fail("obsolete Naver intermediate state remains");
if (renderer.includes("재고·사이즈 판정 근거가 부족합니다.")) fail("obsolete stock-size pending wording remains");
if (!renderer.includes('return { label: `상품 ${products.length}개`, className: "available" };')) fail("overall domestic status is not product-list based");
if (!renderer.includes('? { label: `상품 ${matchedProducts.length}개`, className: "available" }')) fail("site status is not product-list based");
if (!renderer.includes(': { label: "상품 없음", className: "missing" };')) fail("empty site cards do not finish as 상품 없음");
if (!renderer.includes('const detailPending = matchedProducts.length ? "" : "상품 없음";')) fail("site empty detail is not simplified");
if (renderer.includes("검색 입력 실패")) fail("forbidden search-input-failure wording remains");

if (!main.includes('const verifyMusinsaInventory = String(source.store || "") === "무신사";')) fail("Musinsa inventory gate missing");
if (!main.includes('if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);')) fail("size option check is not Musinsa-only");
if (!renderer.includes("무신사 재고만 보기")) fail("inventory-only UI is not labelled Musinsa-only");

console.log("Shared exact product-card verdict engine and official mall binary verdict verified");
