import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource, htmlSource, cssSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("Excel preview is read-only and paginated in the main sourcing screen", () => {
  assert.match(mainSource, /import \{ readFirstDataSheet \} from "\.\/services\/excel-reader\.mjs"/);
  assert.match(mainSource, /async function previewExcelFile/);
  assert.match(mainSource, /filtered\.entries\.slice\(offset, offset \+ limit\)/);
  assert.match(mainSource, /Math\.min\(200, Math\.max\(25,/);
  assert.match(rendererSource, /async function showExcelPreview/);
  assert.match(rendererSource, /previewExcelFile\(file\.path, offset, 100, filters\)/);
  assert.match(rendererSource, /excel-preview-prev/);
  assert.match(rendererSource, /excel-preview-next/);
  assert.match(htmlSource, /읽기 전용|IN-APP EXCEL VIEWER/);
  assert.match(cssSource, /\.excel-preview-grid\{max-height:560px;overflow:auto/);
  assert.match(cssSource, /position:sticky;top:0/);
  assert.match(rendererSource, /Number\.isFinite\(Number\(result\.totalColumns\)\)/);
});

test("Excel preview filters both total-sales columns across all rows", async () => {
  const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(htmlSource, /id="excel-filter-min-total"[^>]+min="0"/);
  assert.match(htmlSource, /id="excel-filter-min-local-total"[^>]+min="0"/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-min-(?:local-)?total"[^>]+value=/);
  assert.match(rendererSource, /minimumTotal: \$\("#excel-filter-min-total"\)\?\.value \?\? ""/);
  assert.match(rendererSource, /minimumLocalTotal: \$\("#excel-filter-min-local-total"\)\?\.value \?\? ""/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-min-(?:local-)?total"[^>]+readonly/);
  assert.match(rendererSource, /#excel-filter-min-total"\)\.value = ""/);
  assert.match(rendererSource, /#excel-filter-min-local-total"\)\.value = ""/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-max-total"/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-max-local-total"/);
  assert.doesNotMatch(rendererSource, /#excel-filter-max-total|#excel-filter-max-local-total/);
  assert.doesNotMatch(htmlSource, /id="excel-filter-match"/);
  assert.doesNotMatch(htmlSource, /둘 중 하나 충족 \(OR\)/);
  assert.match(htmlSource, /두 조건 모두 충족 \(AND\)/);
  assert.match(htmlSource, /id="excel-filter-apply"/);
  assert.match(htmlSource, /id="excel-filter-reset"/);
  assert.match(mainSource, /filterPoizonPreviewRows\(workbook\.headers, workbook\.rows, \{/);
  assert.match(mainSource, /rowNumbers: productView \? \[\] : pageEntries\.map/);
  assert.match(rendererSource, /activeExcelPreview\.filters/);
  assert.match(rendererSource, /필터 결과/);
  assert.match(preloadSource, /previewExcelFile: \(path, offset = 0, limit = 100, filters = \{\}\)/);
});

test("Excel filter controls share one bottom line", () => {
  assert.match(cssSource, /\.excel-preview-filters label\{display:grid;grid-template-columns:1fr;gap:5px;align-self:stretch;margin:0/);
  assert.match(cssSource, /\.excel-preview-filters label>span\{display:flex;align-items:center;min-height:14px;line-height:14px\}/);
  assert.match(cssSource, /\.excel-preview-filters label>input,\.excel-preview-filters label>select\{width:100%\}/);
});

test("Excel defaults to complete raw rows with optional product search view", async () => {
  assert.match(mainSource, /function buildExcelPreviewProducts/);
  assert.doesNotMatch(mainSource, /const grouped = new Map\(\)/);
  assert.match(mainSource, /const productView = input\.filters\?\.productView !== false/);
  assert.match(mainSource, /sourceTotalProducts/);
  assert.doesNotMatch(htmlSource, /id="excel-view-products"|id="excel-view-raw"/);
  assert.match(htmlSource, /원본 Excel 전체 보기/);
  assert.match(rendererSource, /#excel-view-products"\)\?\.classList\.toggle/);
  assert.match(rendererSource, /#excel-view-raw"\)\?\.classList\.toggle/);
  assert.match(rendererSource, /function renderRawExcelCell/);
  assert.match(rendererSource, /function renderRawExcelCell[\s\S]{0,700}<img/);
  assert.match(rendererSource, /#excel-preview-selection"\)\.hidden = false/);
  assert.match(rendererSource, /원본 Excel 그대로/);
  assert.match(await readFile(new URL("../src/excel-column-layout.js", import.meta.url), "utf8"), /viewMode === "products" \|\| preview\?\.viewMode === "raw"/);
  assert.match(rendererSource, /let excelPreviewProductMode = false/);
  assert.match(rendererSource, /filters = \{ \.\.\.filters, productView: excelPreviewProductMode \}/);
  assert.match(rendererSource, /renderExcelProductRows/);
  assert.match(rendererSource, /data-excel-search-product/);
  assert.match(rendererSource, /search\.textContent = excelPreviewBatchSearching \? "검색 중지" : "상품검색"/);
  assert.match(rendererSource, /cachedDomesticSearch\(product, true\)/);
  assert.match(rendererSource, /productCrossCheckIdentity/);
  const productColumns = rendererSource.match(/excel-preview-columns"\)\.innerHTML = `<tr>(.*?)<\/tr>`/)?.[1] || "";
  assert.doesNotMatch(productColumns, /중국 30일|현지 30일/);
  assert.match(productColumns, /평균가격/);
  assert.match(productColumns, /중국 총판매.*현지 총판매.*상품 검색/);
  assert.match(rendererSource, /excel-product-search-detail \$\{groupClass\} \$\{outcomeClass\}"><td colspan="10"/);
  assert.match(cssSource, /\.excel-preview\.product-view \.excel-preview-grid table/);
});

test("brand Excel preview supports popular-list style product selection", () => {
  assert.match(htmlSource, /id="excel-preview-select-page"/);
  assert.match(htmlSource, /id="excel-preview-selected-count"/);
  assert.match(htmlSource, /id="excel-preview-selection-clear"/);
  assert.match(rendererSource, /const selectedExcelPreviewProducts = new Set\(\)/);
  assert.match(rendererSource, /function excelPreviewProductKey/);
  assert.match(rendererSource, /data-excel-product-select/);
  assert.match(rendererSource, /updateExcelPreviewSelectionUi\(pageProductKeys\)/);
  assert.match(cssSource, /\.excel-preview-selection/);
  assert.doesNotMatch(cssSource, /\.excel-preview:not\(\.product-view\) #excel-preview-search-selected\{display:none\}/);
  assert.match(cssSource, /\.excel-product-select-column/);
});

test("selected Excel products calculate profit from the verified list price", () => {
  assert.match(htmlSource, /id="excel-preview-selection-clear"[\s\S]*id="excel-preview-search-selected"[^>]*>상품검색<[\s\S]*id="excel-preview-profit"[^>]*>수익계산</);
  assert.match(htmlSource, /id="profit-selection-summary"/);
  assert.match(rendererSource, /국내 가격 확인 중/);
  assert.match(rendererSource, /excelPreviewSearchResults\.get\(key\)/);
  assert.match(rendererSource, /const poizonPrice = verifiedExcelProductPoizonPrice\(product\)/);
  assert.match(rendererSource, /const domesticPrice = Number\(domestic\?\.price/);
  assert.match(rendererSource, /const poizonFee = poizonServiceFee\(poizonPrice, product\?\.categoryName\)/);
  assert.match(rendererSource, /const totalCost = domesticPrice \+ shipping \+ extra/);
  assert.match(rendererSource, /poizonSettlement - totalCost/);
  assert.match(rendererSource, /netProfit \/ totalCost \* 100/);
  assert.match(rendererSource, /Math\.min\(45_000, Math\.max\(minimum/);
  assert.match(rendererSource, /document\.querySelector\('\.nav\[data-view="profit"\]'\)\?\.click\(\)/);
  assert.match(rendererSource, /function profitResult/);
  assert.match(htmlSource, /POIZON·국내 쇼핑몰 가격 비교/);
  assert.match(htmlSource, /id="profit-comparison-rows"/);
  assert.match(cssSource, /#excel-preview-profit/);
});

test("상품리스트와 수익계산은 동일한 검증 POIZON 가격만 사용한다", () => {
  assert.match(rendererSource, /function verifiedExcelProductPoizonPrice\(product\)/);
  assert.match(rendererSource, /const poizonPrice = verifiedExcelProductPoizonPrice\(product\)/);
  assert.match(rendererSource, /return Number\(product\?\.averagePrice \|\| 0\)/);
  assert.doesNotMatch(rendererSource, /const poizonPrice = Number\(product\?\.averagePrice \|\| 0\)/);
});

test("profit result returns to the preserved Excel product list", () => {
  assert.match(htmlSource, /id="profit-back-to-list"[^>]*>← 상품 리스트로<\/button>/);
  assert.match(rendererSource, /#profit-back-to-list/);
  assert.match(rendererSource, /\.nav\[data-view="products"\]/);
  assert.match(rendererSource, /if \(activeExcelPreview\) \$\("#excel-preview"\)\?\.scrollIntoView/);
  assert.match(cssSource, /\.profit-panel-head/);
});

test("profit comparison store names open their matched purchase links", () => {
  assert.match(rendererSource, /const purchaseUrl = String\(domestic\?\.url \|\| domesticSource\?\.officialProductUrl \|\| domesticSource\?\.searchUrl/);
  assert.match(rendererSource, /class="profit-store-link" data-url="\$\{encodeURIComponent\(item\.purchaseUrl\)\}"/);
  assert.match(rendererSource, /title="구매 페이지 열기"/);
  assert.match(rendererSource, /event\.target\.closest\("\[data-url\]"\)/);
  assert.match(rendererSource, /window\.aroundG\.openExternal\(resolvedUrl\)/);
  assert.match(cssSource, /\.profit-store-link/);
});

test("official-store verification supports every registered URL family and embedded article metadata", () => {
  assert.match(mainSource, /p\|pd\|products\?\|window-products\|goods\|product/);
  assert.match(mainSource, /productDetail\\\\\.action/);
  assert.match(mainSource, /matchesExpected\(link\.href\)/);
  assert.match(mainSource, /matchesExpected\(link\.outerHTML\)/);
  assert.match(mainSource, /productCards\.push\(\{[\s\S]{0,240}productUrl, text, markup, imageUrl, imageLinkedToProduct, title, price, originalPrice,[\s\S]{0,120}officialBrandStoreLabelMatched/);
  assert.match(mainSource, /line-through/);
  assert.match(mainSource, /!candidate\.struck/);
  assert.match(mainSource, /right\.score - left\.score \|\| left\.amount - right\.amount/);
  assert.match(mainSource, /itemView\\\\\.ssg/);
  assert.match(mainSource, /split\("#"\)\[0\]/);
  assert.doesNotMatch(mainSource, /String\(link\.href \|\| ""\)\.split\("\?"\)/);
});

test("official-store result distinguishes verified product links from manual search links", () => {
  assert.match(rendererSource, /source\.officialProductUrl \|\| source\.officialSearchUrl \|\| source\.homepageUrl \|\| source\.searchUrl/);
  assert.match(rendererSource, /matchedProducts\.length \? "판매처 열기" : "판매처 검색"/);
  assert.match(rendererSource, /source\.countVerified && Number\(source\.count \|\| 0\) > 0/);
  assert.doesNotMatch(rendererSource, /data-official-discovery=/);
  assert.match(mainSource, /officialProductMissing: isOfficialStore/);
  assert.match(mainSource, /officialSearchUrl: isOfficialStore/);
});

test("official-mall button remains clickable for direct manual verification", () => {
  assert.match(rendererSource, /const openUrl = String/);
  assert.match(rendererSource, /source\.officialProductUrl \|\| source\.officialSearchUrl \|\| source\.homepageUrl \|\| source\.searchUrl/);
  assert.match(rendererSource, /data-official-homepage/);
  assert.match(rendererSource, /검색·재고 확인/);
});

test("official-mall button runs homepage magnifier search instead of opening a raw URL", () => {
  assert.match(rendererSource, /data-official-homepage=/);
  assert.match(rendererSource, /data-official-query=/);
  assert.match(rendererSource, /openOfficialInternalSearch/);
  assert.match(rendererSource, /sourceProduct\.articleNumber \|\| sourceProduct\.productCode \|\| sourceProduct\.spuId/);
  assert.match(rendererSource, /renderDomestic\(result, product\)/);
});

test("MLB 공식몰 검색창은 품번 입력을 지원한다", () => {
  assert.match(mainSource, /input\[placeholder\*="검색어"\]/);
});

test("unavailable verification is never misreported as confirmed product absence", () => {
  assert.match(mainSource, /renderedSearchFailure/);
  assert.match(mainSource, /pageBlocked/);
  assert.match(mainSource, /verificationFailed: !Number\.isFinite\(count\)/);
  assert.match(rendererSource, /source\.verificationFailed/);
  assert.match(rendererSource, /source\.verificationFailed[\s\S]*?검색 실패/);
  assert.match(rendererSource, /source\.verificationPending[\s\S]*?상세 확인 필요/);
  assert.match(mainSource, /verificationPending/);
  assert.match(mainSource, /absenceConfirmed/);
});

test("official store, Musinsa, and Naver sources all render numeric result badges", () => {
  assert.match(mainSource, /if \(!source\.renderCount\)/);
  assert.match(mainSource, /for \(const queryAttempt of queryAttempts\)/);
  assert.doesNotMatch(mainSource, /technicalAttempts/);
  assert.match(mainSource, /if \(!queryResult\)[\s\S]*?renderedSearchFailure\("unknown_search_failure"\)/);
  assert.match(rendererSource, /label: "추가 확인 필요", className: "pending"/);
  assert.match(rendererSource, /label: "없음 확인", className: "missing"/);
  assert.doesNotMatch(mainSource, /!source\.linkOnly && source\.ok && Number\(source\.count \|\| 0\) > 0/);
  assert.match(mainSource, /renderedSearchSourceResult\(source, articleNumber, brand, title, 0, queryAttempt\)/);
  assert.match(rendererSource, /const sourceSections = sources\.map/);
  assert.doesNotMatch(rendererSource, /filter\(\(source\) => source\.linkOnly\)\.map/);
  assert.doesNotMatch(mainSource, /isBinaryPresenceChannel/);
  assert.match(mainSource, /const displayCount = Number\.isFinite\(count\)[\s\S]*?\? Number\(count\)/);
  assert.doesNotMatch(rendererSource, /Number\(source\.count \|\| 0\) > 0 \? 1 : 0/);
  assert.match(rendererSource, /const sourceStatus = \(source, matchedProducts\)/);
});

test("SSG와 롯데온도 동일 검색어를 한 번만 제출한다", () => {
  assert.doesNotMatch(mainSource, /technicalAttempts/);
  assert.doesNotMatch(mainSource, /attempt > 0\) await wait\(1_500\)/);
});

test("화면 검색 상품도 상세페이지에서 재고와 옵션을 확인한다", () => {
  assert.match(mainSource, /normalizeRenderedStockEvidence/);
  assert.match(mainSource, /purchaseAvailable/);
  assert.match(mainSource, /document\.querySelectorAll\('button,a,\[role="button"\]'/);
  assert.match(rendererSource, /product\.inStock === true \? "재고 있음"/);
  assert.match(rendererSource, /product\.inStock === false \? "품절" : "확인 필요"/);
});

test("병행수입 버튼은 내부 검색을 마친 네이버 쇼핑 결과 주소를 사용한다", () => {
  assert.match(mainSource, /resolvedSearchUrl = String\(searchWindow\.webContents\.getURL/);
  assert.match(mainSource, /searchUrl: String\(result\?\.resolvedSearchUrl \|\| source\.searchUrl/);
});

test("무신사 후보는 상세페이지의 정확한 품번 확인 후 검증 개수로 표시한다", () => {
  assert.match(mainSource, /product\.detailArticleVerificationRequired/);
  assert.match(mainSource, /exactArticleIdentityMatch\(detailText, articleNumber\)/);
  assert.match(rendererSource, /source\.countVerified[\s\S]*?Number\(source\.count\)/);
});

test("shared Excel reader repairs POIZON A1 dimensions before preview and ordinary import", async () => {
  const readerSource = await readFile(new URL("../services/excel-reader.mjs", import.meta.url), "utf8");
  assert.match(readerSource, /repairPoizonWorksheetDimensions\(input\)/);
  assert.match(readerSource, /readSheet\(workbookInput, 1\)/);
  assert.match(readerSource, /readXlsxFile\(workbookInput\)/);
  assert.equal((mainSource.match(/readFirstDataSheet\(await readFile\(filePath\)\)/g) || []).length, 2);
});

test("downloaded file rows open the embedded preview without launching Windows Excel", () => {
  const clickStart = rendererSource.indexOf('$("#brand-download-files").addEventListener("click"');
  const clickEnd = rendererSource.indexOf('$("#brand-download-clear")', clickStart);
  const clickWorkflow = rendererSource.slice(clickStart, clickEnd);

  assert.match(rendererSource, /data-open-brand-file-index/);
  assert.match(rendererSource, /데이터 보기/);
  assert.match(clickWorkflow, /showExcelPreview\(file, 0\)/);
  assert.doesNotMatch(clickWorkflow, /openOriginalExcelFile|shell\.openPath/);
});

test("상품 행과 펼쳐진 국내 검색 결과를 같은 교대 색상으로 묶는다", () => {
  assert.match(rendererSource, /index % 2 === 0 \? "excel-product-group-blue" : "excel-product-group-amber"/);
  assert.match(rendererSource, /excel-product-row \$\{groupClass\}/);
  assert.match(rendererSource, /excel-product-search-detail \$\{groupClass\}/);
  assert.match(rendererSource, /excel-product-search-result-label/);
  assert.match(cssSource, /\.excel-product-row\.excel-product-group-blue td/);
  assert.match(cssSource, /\.excel-product-row\.excel-product-group-amber td/);
  assert.match(cssSource, /\.excel-product-search-detail\.excel-product-group-blue td/);
  assert.match(cssSource, /\.excel-product-search-detail\.excel-product-group-amber td/);
});

test("국내 검색 결과 상태를 강한 전용 색상으로 완전히 구분한다", () => {
  assert.match(rendererSource, /excel-search-outcome-\$\{outcome\.className\}/);
  assert.match(rendererSource, /excel-search-outcome-label/);
  assert.match(rendererSource, /국내 상품 없음/);
  assert.match(rendererSource, /상품 있음·재고 없음/);
  assert.match(cssSource, /\.excel-search-outcome-available\{--excel-outcome-border:#059669/);
  assert.match(cssSource, /\.excel-search-outcome-soldout\{--excel-outcome-border:#d97706/);
  assert.match(cssSource, /\.excel-search-outcome-pending\{--excel-outcome-border:#7c3aed/);
  assert.match(cssSource, /\.excel-search-outcome-missing,.excel-search-outcome-error\{--excel-outcome-border:#dc2626/);
  assert.match(cssSource, /border-left-width:7px!important/);
});

test("네이버 공식 브랜드스토어는 공식브랜드 필터 선택을 확인한 뒤 결과를 읽는다", () => {
  assert.match(mainSource, /async function ensureNaverOfficialBrandFilter/);
  assert.match(mainSource, /mallTypes/);
  assert.match(mainSource, /OFFICIAL_BRAND/);
  assert.match(mainSource, /브랜드직영몰\|공식브랜드\|브랜드스토어/);
  assert.match(mainSource, /source\.store === "네이버 공식 브랜드스토어"/);
  assert.match(mainSource, /if \(!officialBrandSelected\) return renderedSearchFailure\("official_filter_failed"/);
  assert.match(mainSource, /state\?\.target/);
});

test("네이버 백화점과 아울렛은 홈 화면 탭을 실제 마우스 이벤트로 선택한다", () => {
  assert.match(mainSource, /async function clickNaverShoppingHomeMenu/);
  assert.match(mainSource, /compact\(element\.textContent\) === "쇼핑"/);
  assert.match(mainSource, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/"/);
  assert.match(mainSource, /clickNaverShoppingHomeMenu\(searchWindow\)[\s\S]*clickNaverFashionTownMenu\(searchWindow\)/);
  assert.match(mainSource, /async function clickNaverFashionTownMenu/);
  assert.match(mainSource, /const fashionLabels = \["패션타운", "패션위크"\]/);
  assert.match(mainSource, /label\.includes\(fashionLabel\)/);
  assert.match(mainSource, /clickNaverFashionTownMenu\(searchWindow\)[\s\S]*submitNaverShoppingSearch\(searchWindow, searchQuery\)/);
  assert.match(mainSource, /async function openNaverFashionTownSearchInput/);
  assert.ok(mainSource.includes('/상품명\\\\s*또는\\\\s*브랜드/'));
  assert.match(mainSource, /async function submitNaverShoppingSearch/);
  assert.match(mainSource, /async function typeNaverQueryLikeUser/);
  assert.match(mainSource, /for \(let index = 0; index < exactQuery\.length; index \+= 1\)/);
  assert.match(mainSource, /type: "char", keyCode: character/);
  assert.match(mainSource, /document\.activeElement/);
  assert.doesNotMatch(mainSource, /insertText\(exactQuery\)/);
  assert.match(mainSource, /routeOrTitleMatched \|\| selectedMenuMatched \|\| searchScopeMatched/);
  assert.doesNotMatch(mainSource, /fashionTownRoute && searchInput/);
  assert.match(mainSource, /for \(let attempt = 0; attempt < 24/);
  assert.match(mainSource, /show: naverPortalSource/);
  assert.match(mainSource, /if \(naverPortalSource\) searchWindow\.maximize\(\)/);
  assert.doesNotMatch(mainSource, /for \(let attempt = 0; attempt < 3; attempt \+= 1\) \{\n    const inputTarget/);
  assert.match(mainSource, /async function clickNaverShoppingChannel/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(mainSource, /naverChannelClickRequired/);
  assert.match(mainSource, /clickNaverShoppingChannel\(searchWindow, source\.store\)/);
  assert.match(mainSource, /if \(!channelSelected\) return renderedSearchFailure\("channel_selection_failed"/);
  assert.match(mainSource, /submitNaverShoppingSearch\(searchWindow, searchQuery\)[\s\S]*clickNaverShoppingChannel\(searchWindow, source\.store\)/);
});

test("네이버는 결과 클릭 전에 패션타운 채널 숫자 3개를 먼저 확정한다", () => {
  assert.match(mainSource, /async function readNaverFashionTownChannelCounts/);
  assert.match(mainSource, /parseNaverFashionTownChannelCounts\(labels\)/);
  assert.match(
    mainSource,
    /naverChannelCounts = await readNaverFashionTownChannelCounts\(searchWindow\)[\s\S]*if \(currentChannelCount === 0\)[\s\S]*clickNaverShoppingChannel\(searchWindow, source\.store\)/,
  );
  assert.match(mainSource, /if \(naverPortalSource \|\| ssgChannelSource\) \{\s*await wait\(1_500\);\s*\} else \{/);
  assert.match(mainSource, /recognizedChannelCounts = .*naverChannelCounts/);
  assert.match(mainSource, /source\.store === "네이버 백화점" \? "departmentStoreLabelMatched"/);
  assert.match(mainSource, /source\.store === "네이버 아울렛" \? "outletLabelMatched"/);
  assert.match(mainSource, /currentChannelCount === 1[\s\S]*labeledChannelCards\.length !== 1/);
  assert.match(mainSource, /channel_card_evidence_mismatch/);
  assert.match(mainSource, /clickRenderedProductCard\(searchWindow, product\.url, resolvedSearchUrl\)[\s\S]*openRenderedSizeOptions\(searchWindow\)/);
});

test("SSG 백화점·아울렛도 상단 채널과 하단 카드를 확인한 뒤 실제 상세 링크를 보존한다", () => {
  assert.match(mainSource, /\["SSG 백화점", "SSG 아울렛"\]\.includes/);
  assert.match(mainSource, /pageHeaderText/);
  assert.match(mainSource, /ssg_channel_evidence_mismatch/);
  assert.match(mainSource, /sourceStore: String\(product\.sourceStore \|\| product\.store \|\| source\.store/);
  assert.match(mainSource, /const verifiedProductUrl = String\(\(result\?\.products \|\| \[\]\)/);
  assert.match(rendererSource, /source\.verifiedProductUrl \|\| source\.officialProductUrl/);
  assert.match(rendererSource, /sourceStore === String\(product\?\.sourceStore/);
  assert.doesNotMatch(rendererSource, /data-url="\$\{encodeURIComponent\(source\.searchUrl \|\| openUrl\)\}"/);
});

test("상품 상세페이지는 사이즈 옵션을 열고 출력값을 수집한다", () => {
  assert.match(mainSource, /async function openRenderedSizeOptions/);
  assert.match(mainSource, /await openRenderedSizeOptions\(searchWindow\)/);
  assert.match(mainSource, /role=.*listbox.*li/);
  assert.match(mainSource, /class.*dropdown.*li/);
});

test("Excel preview replaces the file list and restores its scroll position", () => {
  assert.match(htmlSource, /id="excel-preview-close"[^>]*>← 파일 목록으로</);
  assert.match(rendererSource, /let excelFilesListScrollPosition = 0/);
  assert.match(rendererSource, /classList\.add\("excel-preview-mode"\)/);
  assert.match(rendererSource, /classList\.add\("excel-data-view-open"\)/);
  assert.match(rendererSource, /classList\.add\("excel-preview-active"\)/);
  assert.match(rendererSource, /window\.scrollTo\(\{ top: excelFilesListScrollPosition/);
  assert.match(cssSource, /\.excel-files-panel\.excel-preview-mode\{height:calc\(100vh - 166px\)/);
  assert.match(cssSource, /\.excel-files-panel\.excel-preview-mode \.excel-preview-grid\{flex:1;min-height:0;max-height:none\}/);
  assert.match(cssSource, /body\.excel-preview-active\{overflow:hidden\}/);
});

test("successful original downloads use the concise confirmation label", () => {
  assert.match(rendererSource, /POIZON 원본 · 확인완료/);
  assert.match(rendererSource, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.doesNotMatch(rendererSource, /100% 검증완료/);
});

test("completed brand downloads open integrated product search by job-linked Excel", () => {
  assert.match(htmlSource, /id="brand-product-workspace"/);
  assert.match(htmlSource, /id="brand-integrated-preview-host"/);
  assert.match(rendererSource, /data-completed-action="search">상품검색/);
  assert.match(rendererSource, /data-completed-action="excel">Excel 보기/);
  assert.match(rendererSource, /data-completed-action="folder">폴더 열기/);
  assert.match(rendererSource, /openIntegratedBrandExcel\(file/);
  assert.match(rendererSource, /minimumTotal: minimum/);
  assert.match(rendererSource, /minimumLocalTotal: minimum/);
  assert.match(rendererSource, /EXCEL_SEARCH_RESULTS_KEY/);
  assert.match(rendererSource, /persistExcelSearchResults/);
});

test("integrated product search keeps original rows and opens product search only on manual request", () => {
  assert.match(rendererSource, /excelPreviewProductMode = false/);
  assert.match(rendererSource, /productView: false/);
  assert.match(rendererSource, /excel-view-products"[\s\S]*excelPreviewProductMode = true/);
  assert.match(rendererSource, /activeExcelPreview\?\.viewMode !== "products"/);
  assert.match(rendererSource, /상품 목록 준비 중/);
  assert.match(rendererSource, /productView: true/);
  assert.match(rendererSource, /product\.key \|\| product\.articleNumber \|\| product\.spuId/);
  assert.match(rendererSource, /excelPreviewProductCache\.has\(key\)/);
  assert.match(rendererSource, /검색을 완료했습니다/);
});


test("raw Excel view preserves original rows and display-only columns", () => {
  assert.match(mainSource, /const filtered = productView[\s\S]*workbook\.rows\.map\(\(values, index\) => \(\{ values, sourceRowNumber: index \+ 2 \}\)\)/);
  assert.match(mainSource, /headers: Array\.from\(\{ length: columnCount \}, \(_unused, index\) => excelPreviewCell\(rows\[0\]\?\.\[index\]\)\)/);
  assert.match(rendererSource, /else \{[\s\S]{0,500}excel-product-select-column/);
  assert.match(rendererSource, /aria-label="제품 이미지 크게 보기"/);
  assert.match(rendererSource, /const displayValue = !value \? "숨김" : cell/);
  assert.match(rendererSource, /\? "숨김" : cell/);
  assert.match(rendererSource, /rows\.map\(\(row, index\) =>/);
});


test("raw Excel rows restore domestic platform search without grouping products", () => {
  assert.match(mainSource, /buildExcelPreviewProducts\(workbook\.headers, pageEntries\)/);
  assert.match(rendererSource, /<th>국내 상품검색<\/th>/);
  assert.match(rendererSource, /data-excel-search-product/);
  assert.match(rendererSource, /productsByRow/);
  assert.match(rendererSource, /pageProductsByRow/);
  assert.match(rendererSource, /activeExcelPreview\?\.viewMode === "products"/);
  assert.match(rendererSource, /showExcelPreview\(file, activeExcelPreview\?\.offset/);
});

test("domestic portal query excludes long POIZON descriptions when article exists", () => {
  assert.match(rendererSource, /articleNumber\s*\?\s*\[brandName, articleNumber\]/);
  assert.doesNotMatch(rendererSource, /query:\s*\[product\.brandName[^\n]+product\.title/);
});
