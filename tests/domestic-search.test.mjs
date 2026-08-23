import test from "node:test";
import assert from "node:assert/strict";
import {
  DOMESTIC_SEARCH_LINKS,
  OFFICIAL_BRAND_SEARCH,
  analyzeRenderedChannelProducts,
  classifySsgProductEvidence,
  detectedRetailer,
  isPlatformShoppingProductUrl,
  isConsignmentOperatedProduct,
  isOverseasPurchaseProduct,
  countLinkedSearchProducts,
  countRenderedChannelProducts,
  domesticChannelUrl,
  exactArticleIdentityMatch,
  isSsgOfficialBrandHall,
  internalPortalSearchQuery,
  naverFashionTownUrl,
  naverFashionTownPortalUrl,
  naverShoppingPortalUrl,
  normalizeRenderedStockEvidence,
  officialBrandProductSearchUrl,
  officialBrandSearchUrl,
  officialBrandUsesInternalSearch,
  parseKolonSearch,
  parseMusinsaSearch,
  parseNaverFashionTownChannelCounts,
  parseSsgSearch,
  queryDomesticProducts,
  resolveSsgProductClassification,
  sanitizeDomesticProductCode,
} from "../relay/domestic-search.mjs";

test("POIZON category suffix is removed before a product code is typed", () => {
  assert.equal(sanitizeDomesticProductCode("SR123UPS11-服"), "SR123UPS11");
  assert.equal(sanitizeDomesticProductCode(" 3ASXCA12N-50WHS "), "3ASXCA12N-50WHS");
});

test("네이버 패션타운은 상품 클릭 전에 세 채널 숫자를 모두 인식한다", () => {
  assert.deepEqual(parseNaverFashionTownChannelCounts([
    "전체\n1개",
    "브랜드직영몰\n1개",
    "백화점\n0개",
    "아울렛\n0개",
    "소호&스트릿\n0개",
  ]), {
    "네이버 공식 브랜드스토어": 1,
    "네이버 백화점": 0,
    "네이버 아울렛": 0,
  });
  assert.equal(parseNaverFashionTownChannelCounts(["브랜드직영몰 1개", "백화점 0개"]), null);
});

test("해외직구·구매대행·해외배송 상품은 국내 결과에서 제외한다", () => {
  for (const label of ["해외직구", "해외 구매대행", "구매 대행", "해외배송", "해외배송비 30,000원", "international shipping"]) {
    assert.equal(isOverseasPurchaseProduct(`나이키 축구화 HG0019-104 ${label}`), true, label);
  }
  assert.equal(isOverseasPurchaseProduct("나이키코리아 공식스토어 국내배송"), false);
  const rendered = JSON.stringify({
    pageText: "브랜드직영몰 4개",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/brandfashion/123",
      title: "나이키 가토 HG0019-104",
      text: "해외직구 구매대행 해외배송비 30,000원",
    }],
  });
  const result = analyzeRenderedChannelProducts(rendered, "네이버 공식 브랜드스토어", "HG0019-104", "나이키");
  assert.equal(result.count, 0);
  assert.deepEqual(result.products, []);
  assert.equal(result.presenceConfirmed, false);
});

test("모든 국내 판매처 상세페이지 재고를 세 단계로 판정한다", () => {
  assert.deepEqual(normalizeRenderedStockEvidence({
    purchaseAvailable: true,
    options: [
      { label: "250", inStock: false },
      { label: "255", inStock: true },
      { label: "선택해주세요", inStock: true },
    ],
  }), {
    inStock: true,
    sizes: [{ label: "250", inStock: false }, { label: "255", inStock: true }],
    stockStatus: "available",
    stockVerified: true,
  });
  assert.equal(normalizeRenderedStockEvidence({ pageText: "현재 상품은 품절되었습니다" }).inStock, false);
  assert.equal(normalizeRenderedStockEvidence({ pageText: "상품 상세정보" }).inStock, null);
});

test("국내 매장 유통 100% 정품 안내 상세페이지는 위탁운영 상품으로 제외한다", () => {
  assert.equal(isConsignmentOperatedProduct(
    "정품안내 판매하는 모든 상품은 국내 매장에 유통되는 100% 정품으로 믿고 구매하셔도 문제 없습니다."
  ), true);
  assert.equal(isConsignmentOperatedProduct("브랜드 본사직영 공식 온라인스토어 정품"), false);
});

test("SSG 브랜드 검색은 공식수입·공식브랜드관 증빙과 병행수입업체를 구분한다", () => {
  assert.equal(classifySsgProductEvidence({
    brand: "나이키",
    url: "https://www.ssg.com/item/itemView.ssg?itemId=1000190212238",
    text: "공식수입 [나이키코리아공식] NIKE 공식브랜드관 DC6479-100",
  }), "official_brand");
  assert.equal(classifySsgProductEvidence({
    brand: "나이키",
    url: "https://www.ssg.com/item/itemView.ssg?itemId=1000673689289",
    text: "구템즈 병행수입 나이키 DD8959-100",
  }), "parallel_import");
  assert.equal(classifySsgProductEvidence({
    brand: "나이키",
    url: "https://www.ssg.com/item/itemView.ssg?itemId=1000854826548",
    text: "NIKE 로고 정식 통관 정품 BAZIC 베이직 누적매출",
  }), "parallel_import");
  assert.equal(detectedRetailer("BAZIC 정식 통관 정품"), "병행수입 정품업체 · 베이직");
  assert.equal(classifySsgProductEvidence({
    brand: "나이키",
    url: "https://www.ssg.com/item/itemView.ssg?itemId=1000854826548",
    text: "검은 원형 NIKE 로고 정품",
  }), "marketplace");
});

test("SSG 정확 품번의 본사직영 브랜드 상품을 공식 판매 결과로 표시한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000987654321",
      title: "[데상트 공식] 터프 반팔 티셔츠 블랙 SR323UTS71",
      text: "데상트 본사직영 5% 57,950원 무료배송",
      markup: '<li class="cunit"><span class="badge">본사직영</span><strong>데상트</strong><a href="/item/itemView.ssg?itemId=1000987654321">SR323UTS71</a></li>',
    }],
    pageText: "데상트 데상트 SR323UTS71 검색 결과",
  }), "SSG", "SR323UTS71", "데상트");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].store, "SSG 브랜드 공식관");
  assert.equal(result.products[0].retailerName, "브랜드 공식관 · 본사직영");
  assert.equal(result.products[0].officialStoreVerified, true);
});

test("SSG 검색 카드의 본사직영 판정은 상세페이지에 문구가 없어도 유지한다", () => {
  assert.equal(resolveSsgProductClassification("marketplace", "official_brand"), "official_brand");
  assert.equal(resolveSsgProductClassification("parallel_import", "official_brand"), "parallel_import");
});

test("SSG 정확 품번 검색 결과를 확인했지만 일치 상품이 없으면 상품 없음으로 확정한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000000000001",
      title: "나이키 다른 상품 AB1234-001",
      text: "나이키 다른 상품 AB1234-001",
    }],
    pageText: "SSG 통합검색 상품 1개",
  }), "SSG", "DD8959-100", "나이키");
  assert.equal(result.count, 0);
  assert.equal(result.absenceConfirmed, true);
});

test("편집샵·병행수입 검색은 쇼핑 플랫폼 상품 상세 주소만 허용한다", () => {
  assert.equal(isPlatformShoppingProductUrl("https://blog.naver.com/wjsepdyt/223774129711"), false);
  assert.equal(isPlatformShoppingProductUrl("https://cafe.naver.com/example/123"), false);
  assert.equal(isPlatformShoppingProductUrl("https://brand.naver.com/sample/products/123456789"), true);
  assert.equal(isPlatformShoppingProductUrl("https://shopping.naver.com/window-products/brandfashion/124925333777"), true);
  assert.equal(isPlatformShoppingProductUrl("https://www.ssg.com/item/itemView.ssg?itemId=1000833166393"), true);
  const rendered = JSON.stringify({ productCards: [
    { productUrl: "https://blog.naver.com/wjsepdyt/223774129711", text: "데상트 SR323UPS74 병행수입" },
    { productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000833166393", text: "데상트 SR323UPS74 정품" },
  ] });
  const result = analyzeRenderedChannelProducts(rendered, "병행수입·편집샵", "SR323UPS74", "데상트");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].url.includes("ssg.com/item/"), true);
});
import { OFFICIAL_DOMAIN_STATUS } from "../services/official-domain-registry.mjs";

test("every catalog brand uses the Fashion Town search with the product code only", () => {
  const url = decodeURIComponent(officialBrandSearchUrl("살로몬", "L47581100"));
  assert.match(url, /shopping\.naver\.com\/window\/search\/fashion-group/);
  assert.match(url, /q=L47581100/);
  assert.doesNotMatch(url, /살로몬/);
  assert.match(url, /L47581100/);
  assert.doesNotMatch(url, /공식몰|공식스토어/);
  assert.equal(officialBrandProductSearchUrl("살로몬", "L47581100"), "");
});

test("every catalog brand gets article-specific Naver channel searches", () => {
  const cases = [
    ["brand-store", /\/window\/search\/fashion-group/],
    ["department", /\/window\/department\/search/],
    ["outlet", /\/window\/outlet\/search/],
  ];
  for (const [channel, path] of cases) {
    const url = decodeURIComponent(naverFashionTownUrl(channel, "살로몬", "L47581100"));
    assert.match(url, /L47581100/);
    assert.match(url, path);
    assert.doesNotMatch(url, /공식몰|공식스토어/);
  }
});

test("네이버 자동화는 포털 검색창을 사용하고 수동 확인 링크도 검색어를 보존한다", async () => {
  assert.equal(naverFashionTownPortalUrl("brand-store"), "https://shopping.naver.com/");
  assert.equal(naverFashionTownPortalUrl("department"), "https://shopping.naver.com/window/department");
  assert.equal(internalPortalSearchQuery("데상트", "데상트 SR123UTS15"), "데상트 SR123UTS15");
  assert.equal(internalPortalSearchQuery("데상트", "SR123UTS15"), "데상트 SR123UTS15");
  const result = await queryDomesticProducts({
    query: "데상트 SR123UTS15",
    articleNumber: "SR123UTS15",
    brand: "데상트",
    fetchImpl: async () => ({
      ok: true,
      text: async () => '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[]}}}}</script>',
    }),
  });
  const naver = result.sources.find((source) => source.store === "네이버 공식 브랜드스토어");
  assert.match(naver.searchUrl, /shopping\.naver\.com\/window\/search\/fashion-group/);
  assert.match(naver.searchUrl, /q=SR123UTS15/);
  assert.equal(naver.interactiveSearch, true);
  assert.equal(naver.searchQuery, "SR123UTS15");
  assert.match(naver.searchUrl, /q=/);
});

test("품번이 있으면 상품코드, 상품명, 상품명+상품코드 순으로 검색한다", async () => {
  const result = await queryDomesticProducts({
    query: "MLB 3ASXCA12N-50WHS MLB 차키 내피 합성 가죽 인조가죽 로우탑 스니커즈",
    articleNumber: "3ASXCA12N-50WHS",
    brand: "MLB",
    title: "MLB 차키 내피 합성 가죽 인조가죽 로우탑 스니커즈",
    searchStrategy: "combined",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  assert.deepEqual(result.queryCandidates, [
    "3ASXCA12N-50WHS",
    "MLB 차키 내피 합성 가죽 인조가죽 로우탑 스니커즈",
    "MLB 차키 내피 합성 가죽 인조가죽 로우탑 스니커즈 3ASXCA12N-50WHS",
  ]);
  const department = result.sources.find((source) => source.store === "네이버 백화점");
  assert.equal(department.searchQuery, "3ASXCA12N-50WHS");
  assert.doesNotMatch(department.searchQuery, /가죽|로우탑|스니커즈/);
});

test("MLB 공식몰은 홈페이지 돋보기 뒤 상품코드만 검색창에 입력한다", async () => {
  assert.equal(officialBrandUsesInternalSearch("MLB"), true);
  const result = await queryDomesticProducts({
    query: "MLB 3ASXCA12N-50WHS",
    articleNumber: "3ASXCA12N-50WHS",
    brand: "MLB",
    title: "청키 라이너 뉴욕양키스",
    fetchImpl: async () => ({
      ok: true,
      text: async () => '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[]}}}}</script>',
    }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.equal(official.homepageUrl, "https://www.mlb-korea.com/?gf=A");
  assert.equal(official.officialProductUrl, "");
  assert.equal(official.interactiveSearch, true);
  assert.equal(official.searchQuery, "3ASXCA12N-50WHS");
});

test("모든 브랜드 공식몰은 품번이 있으면 상품코드만 검색한다", async () => {
  assert.equal(officialBrandUsesInternalSearch("데상트"), true);
  const result = await queryDomesticProducts({
    query: "데상트 SR123UTS15",
    articleNumber: "SR123UTS15",
    productCode: "DESCENTE-001",
    brand: "데상트",
    title: "스몰 워딩 코튼 반팔 티셔츠",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.equal(official.homepageUrl, "https://dk-on.com/DESCENTE");
  assert.equal(official.officialProductUrl, "");
  assert.equal(official.interactiveSearch, true);
  assert.equal(official.searchQuery, "SR123UTS15");
});

test("브랜드 공식몰은 품번이 없을 때 상품코드로 검색한다", async () => {
  const result = await queryDomesticProducts({
    query: "데상트 DESCENTE-001",
    productCode: "DESCENTE-001",
    brand: "데상트",
    title: "스몰 워딩 코튼 반팔 티셔츠",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.equal(official.searchQuery, "DESCENTE-001");
});

test("병행수입 검색은 네이버 통합검색이 아닌 쇼핑 포털 내부 검색을 사용한다", async () => {
  assert.equal(naverShoppingPortalUrl(), "https://shopping.naver.com/home");
  const result = await queryDomesticProducts({
    query: "데상트 SR123UTS15",
    articleNumber: "SR123UTS15",
    brand: "데상트",
    fetchImpl: async () => ({
      ok: true,
      text: async () => '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[]}}}}</script>',
    }),
  });
  const parallel = result.sources.find((source) => source.store === "병행수입·편집샵");
  assert.equal(parallel.searchUrl, "https://shopping.naver.com/home");
  assert.equal(parallel.interactiveSearch, true);
  assert.equal(parallel.searchQuery, "데상트 SR123UTS15");
  assert.doesNotMatch(parallel.searchUrl, /search\.naver\.com|query=|q=/);
});

test("무신사 검색 카드에 품번이 없어도 같은 브랜드 상세페이지 검증 후보로 유지한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://www.musinsa.com/products/2311096",
      title: "엠엘비(MLB) 청키 라이너 NY (White)",
      text: "엠엘비 125,100원",
    }],
    pageText: "무신사 검색 결과",
  }), "무신사", "3ASXCA12N-50WHS", "MLB");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].detailArticleVerificationRequired, true);
  assert.equal(result.products[0].url, "https://www.musinsa.com/products/2311096");
});

const officialStoreCases = [
  ["아디다스", "JH5469", "adidas.co.kr"],
  ["나이키", "IB5824-001", "nike.com"],
  ["뉴발란스", "U9060BLK", "nbkorea.com"],
  ["푸마", "398846-31", "puma.com"],
  ["언더아머", "1379296-001", "underarmour.co.kr"],
  ["아식스", "1203A537-001", "asics.com"],
  ["반스", "VN000D5IBKA", "vans.co.kr"],
  ["크록스", "209651-001", "crocs.co.kr"],
  ["데상트", "SN123LSN11", "dk-on.com"],
  ["MLB", "3ASXCA12N-50WHS", "mlb-korea.com"],
  ["온", "3ME10100264", "on.com"],
];

test("all curated official stores build an HTTPS article search URL", () => {
  assert.equal(OFFICIAL_BRAND_SEARCH.length, officialStoreCases.length);
  for (const [brand, articleNumber, host] of officialStoreCases) {
    const url = new URL(officialBrandProductSearchUrl(brand, articleNumber));
    assert.equal(url.protocol, "https:");
    assert.match(url.hostname, new RegExp(host.replaceAll(".", "\\."), "i"));
    assert.match(decodeURIComponent(url.href), new RegExp(articleNumber, "i"));
  }
});

test("SSG channel submits the requested query without adding a brand", () => {
  const url = domesticChannelUrl("ssg-department", "MLB", "MLB 3ASXCA12N-50WHS");
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "department.ssg.com");
  assert.equal(parsed.searchParams.get("query"), "MLB 3ASXCA12N-50WHS");
  assert.equal(new URL(domesticChannelUrl("ssg-general", "MLB", "3ASXCA12N-50WHS")).searchParams.get("query"), "3ASXCA12N-50WHS");
});

test("LotteON channels use the current csearch route with the requested query", () => {
  const general = new URL(domesticChannelUrl("lotte-general", "MLB", "MLB 3ASXCA12N-50WHS"));
  assert.equal(general.pathname, "/csearch/search/search");
  assert.equal(general.searchParams.get("q"), "MLB 3ASXCA12N-50WHS");
  assert.equal(general.searchParams.get("sort"), "ranking");
  const department = new URL(domesticChannelUrl("lotte-department", "MLB", "3ASXCA12N-50WHS"));
  assert.equal(department.searchParams.get("mallId"), "2");
  assert.equal(department.searchParams.get("q"), "3ASXCA12N-50WHS");
});

test("all registered official-store product URL shapes match their exact article", () => {
  const fixtures = [
    ["아디다스", "JH5469", "https://www.adidas.co.kr/삼바-og/JH5469.html"],
    ["나이키", "IB5824-001", "https://www.nike.com/kr/t/air-superfly/v6MNQ3id/IB5824-001"],
    ["뉴발란스", "U9060BLK", "https://www.nbkorea.com/product/productDetail.action?styleCode=U9060BLK"],
    ["푸마", "398846-31", "https://kr.puma.com/kr/ko/pd/speedcat-og/398846.html?dwvar_398846_color=31"],
    ["언더아머", "1379296-001", "https://www.underarmour.co.kr/ko-kr/p/shoes/1379296.html?dwvar_1379296_color=001"],
    ["아식스", "1203A537-001", "https://www.asics.com/kr/ko-kr/gel-kayano/p/AK_1203A537-001.html"],
    ["반스", "VN000D5IBKA", "https://www.vans.co.kr/product/old-skool/VN000D5IBKA"],
    ["크록스", "209651-001", "https://www.crocs.co.kr/p/classic/209651.html?color=001"],
    ["데상트", "SN123LSN11", "https://dk-on.com/DESCENTE/product/detail/SN123LSN11"],
    ["온", "3ME10100264", "https://www.on.com/ko-kr/products/cloudtilt-m-3me1010/mens/eclipse-black-shoes-3ME10100264"],
  ];
  for (const [brand, articleNumber, productUrl] of fixtures) {
    const rendered = JSON.stringify({ productCards: [{ productUrl, text: `${brand} 공식 상품` }] });
    assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", articleNumber), 1, brand);
  }
});

test("department and outlet channels use their own search scopes", () => {
  const cases = [
    ["ssg-department", /department\.ssg\.com/],
    ["ssg-outlet", /siteNo=7008/],
    ["lotte-department", /mallId=2/],
    ["lotte-outlet", /mallFilter=.*%EC%95%84%EC%9A%B8%EB%A0%9B/],
  ];
  for (const [channel, expected] of cases) {
    const url = domesticChannelUrl(channel, "온", "3ME10100264");
    assert.match(url, expected);
    assert.match(decodeURIComponent(url), /3ME10100264/);
    assert.doesNotMatch(new URL(url).searchParams.get("query") || new URL(url).searchParams.get("q") || "", /^온\s/);
  }
});

test("a zero channel tab overrides unrelated matching recommendations", () => {
  const rendered = JSON.stringify({
    pageText: "전체 1개 백화점 0개 해외직구 1개 검색된 상품이 없습니다.",
    productCards: [{ productUrl: "https://example.test/product/3ME10100264", text: "해외직구 On 3ME10100264" }],
  });
  assert.equal(countRenderedChannelProducts(rendered, "네이버 백화점", "3ME10100264"), 0);
});

test("a marketplace result must match both the article and the brand", () => {
  const wrongBrand = JSON.stringify({
    pageText: "검색 결과",
    productCards: [{ productUrl: "https://example.test/product/3ME10100264", text: "나이키 3ME10100264" }],
  });
  const correctBrand = JSON.stringify({
    pageText: "검색 결과",
    productCards: [{ productUrl: "https://example.test/product/3ME10100264", text: "On Cloudtilt 3ME10100264" }],
  });
  assert.equal(countRenderedChannelProducts(wrongBrand, "SSG 백화점", "3ME10100264", "온"), 0);
  assert.equal(countRenderedChannelProducts(correctBrand, "SSG 백화점", "3ME10100264", "온"), 1);
});

test("병행수입 검색은 요청 모델번호가 상품 카드에 정확히 있을 때만 표시한다", () => {
  const unrelatedRecommendations = JSON.stringify({
    pageText: "나이키 DD1503-101 검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/products/123456789",
      title: "나이키 런닝화 우먼스 줌 스트럭처 25",
      text: "브릭맨션 94,100원",
    }],
  });
  const exactModel = JSON.stringify({
    pageText: "검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/products/987654321",
      title: "나이키 우먼스 덩크 로우 DD1503-101",
      text: "브릭맨션 병행수입 상품",
    }],
  });
  assert.equal(analyzeRenderedChannelProducts(unrelatedRecommendations, "병행수입·편집샵", "DD1503-101", "나이키").count, 0);
  assert.equal(analyzeRenderedChannelProducts(exactModel, "병행수입·편집샵", "DD1503-101", "나이키").count, 1);
});

test("국내 병행수입업체는 포함하고 같은 품번의 해외직구 상품은 제외한다", () => {
  const rendered = JSON.stringify({
    pageText: "뉴에라 10531940 검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/brandfashion/1001",
      title: "뉴에라 MLB 엠엘비 리그 베이직 볼캡 모자 그레이 10531940",
      text: "신세계 부산 대림코퍼레이션 27,900원 오늘출발",
    }, {
      productUrl: "https://shopping.naver.com/products/1002",
      title: "NEW ERA 10531940 볼캡",
      text: "해외 구매대행 해외배송 71,500원",
    }],
  });
  const result = analyzeRenderedChannelProducts(rendered, "병행수입·편집샵", "10531940", "뉴에라");
  assert.equal(result.count, 1);
  assert.equal(result.products.length, 1);
  assert.match(result.products[0].retailerName, /병행수입 정품업체 · 대림코퍼레이션/);
  assert.equal(result.products[0].title.includes("10531940"), true);
});

test("an MLB result with a different explicit article is never relabeled as the requested article", () => {
  const rendered = JSON.stringify({
    pageText: "MLB 공식몰 검색 결과 104개",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/brandfashion/124925333777",
      title: "[MLB] 시그니처 언스트럭쳐 볼캡 LA Blue 3ACPB245N",
      text: "MLB 공식 상품 43,000원",
      imageUrl: "https://example.test/blue-cap.jpg",
    }],
  });
  const result = analyzeRenderedChannelProducts(rendered, "네이버 공식 브랜드스토어", "3ACP6601N", "MLB", "에이스 언스트럭쳐 볼캡 LA Black");
  assert.equal(result.count, 0);
  assert.deepEqual(result.products, []);
});

test("official-store matching can use article metadata in a product card", () => {
  const rendered = JSON.stringify({
    productCards: [{
      productUrl: "https://example.test/p/product-slug",
      text: "공식 상품",
      markup: '<article data-style-code="VN000D5IBKA"><a href="/p/product-slug">보기</a></article>',
    }],
  });
  assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", "VN000D5IBKA"), 1);
});

test("Nike official result recognizes a Korean /t/ product URL by article number", () => {
  const rendered = JSON.stringify({
    productCards: [{
      productUrl: "https://www.nike.com/kr/t/air-superfly-womens-shoes-v6MNQ3id/IB5824-001",
      text: "나이키 에어 슈퍼플라이 여성 신발",
    }],
  });
  assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", "IB5824-001"), 1);
  assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", "IB5824-002"), 0);
});

test("PUMA official result recognizes /pd/ URL and separated color query", () => {
  const rendered = JSON.stringify({
    productCards: [{
      productUrl: "https://kr.puma.com/kr/ko/pd/speedcat-og/398846.html?dwvar_398846_color=31",
      text: "스피드캣 OG Speedcat OG 149,000원",
    }],
  });
  assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", "398846-31"), 1);
  assert.equal(countRenderedChannelProducts(rendered, "브랜드 공식몰", "398846-32"), 0);
});

test("SSG and Lotte dynamic product links become visible product candidates", () => {
  const fixtures = [
    ["SSG 백화점", "https://department.ssg.com/item/itemView.ssg?itemId=1000612345", "나이키 에어맥스 IO9554-100 169,000원"],
    ["롯데온 백화점", "https://www.lotteon.com/p/product/LO1234567890", "나이키 페가수스 HQ7540-100 159,000원"],
  ];
  for (const [store, productUrl, text] of fixtures) {
    const articleNumber = text.match(/[A-Z]{2}\d{4}-\d{3}/)?.[0];
    const result = analyzeRenderedChannelProducts(JSON.stringify({
      pageText: "검색 결과",
      productCards: [{ productUrl, text, title: text, imageUrl: "https://img.example/product.jpg", price: "159,000원" }],
    }), store, articleNumber, "나이키");
    assert.equal(result.count, 1, store);
    assert.equal(result.products.length, 1, store);
    assert.equal(result.products[0].articleNumber, articleNumber, store);
  }
});

test("SSG와 롯데는 품번이 링크 바깥 상품 카드에 있어도 수집하고 같은 검색을 반복하지 않는다", async () => {
  const mainSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../main.mjs", import.meta.url), "utf8"));
  assert.match(mainSource, /const articleCardLinks =/);
  assert.match(mainSource, /matchesExpected\(card\.innerText\) \|\| matchesExpected\(card\.outerHTML\)/);
  assert.match(mainSource, /new Set\(\[\.\.\.directProductLinks, \.\.\.articleCardLinks\]\)/);
  assert.doesNotMatch(mainSource, /technicalAttempts/);
  assert.match(mainSource, /const queryResult = await renderedSearchSourceResult/);
});

test("SSG department Korean brand result waits for detail-page stock evidence", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    pageText: "아디다스 IH0274 검색 결과입니다.",
    pageBlocked: false,
    productCards: [{
      productUrl: "https://department.ssg.com/item/itemView.ssg?itemId=1000612345",
      text: "아디다스 남녀공용 데일리 캐주얼 운동화 IH0274 스피리테인 2.0 98,100원",
      title: "아디다스 스피리테인 2.0 IH0274",
      imageUrl: "https://img.example/ih0274.jpg",
      price: "98,100원",
    }],
  }), "SSG 백화점", "IH0274", "Adidas");
  assert.equal(result?.count, 1);
  assert.equal(result?.products[0]?.inStock, null);
  assert.equal(result?.products[0]?.price, 98100);
});

test("네이버 할인 상품은 취소선 정상가와 실제 판매가를 구분한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    pageText: "아디다스 IH1321 검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191642",
      text: "아디다스 R71 IH1321 109,000원 20% 87,200원",
      title: "아디다스 R71 IH1321",
      price: "87,200원",
      originalPrice: "109,000원",
    }],
  }), "네이버 아울렛", "IH1321", "아디다스");
  assert.equal(result?.products[0]?.price, 87200);
  assert.equal(result?.products[0]?.originalPrice, 109000);
});

test("숫자형 품번은 개별 상품 제목에서 정확히 일치할 때만 인정한다", () => {
  assert.equal(exactArticleIdentityMatch("레고 테크닉 42226-1 자동차", "42226-1"), true);
  assert.equal(exactArticleIdentityMatch("레고 테크닉 42226 1 자동차", "42226-1"), true);
  assert.equal(exactArticleIdentityMatch("레고 테크닉 142226-1 자동차", "42226-1"), false);
  assert.equal(exactArticleIdentityMatch("레고 테크닉 42226-10 자동차", "42226-1"), false);
});

test("검색 URL과 HTML 공통문구의 레고 품번은 상품 일치 근거가 아니다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    pageText: "LEGO 42226-1 검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/window/search?q=LEGO%2042226-1&product=999",
      markup: '<article data-query="LEGO 42226-1">추천 상품</article>',
      text: "레고 시티 경찰차 60312 29,900원",
      title: "레고 시티 경찰차 60312",
      price: "29,900원",
    }],
  }), "네이버 아울렛", "42226-1", "LEGO");
  assert.equal(result?.count, 0);
  assert.deepEqual(result?.products, []);
});

test("정확한 레고 품번이 상품 제목에 있으면 검색 결과로 인정한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    pageText: "LEGO 42226-1 검색 결과",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/123",
      text: "레고 테크닉 42226-1 129,000원",
      title: "LEGO 테크닉 42226-1",
      price: "129,000원",
    }],
  }), "네이버 아울렛", "42226-1", "LEGO");
  assert.equal(result?.count, 1);
  assert.equal(result?.products[0]?.price, 129000);
});

test("네이버 단일 결과는 품번이 생략돼도 브랜드와 상품명이 일치하면 인정한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/1234567890",
      title: "[코오롱스포츠] 남성 데이팩 베이직 쇼츠",
      text: "코오롱스포츠 브랜드직영몰 남성 데이팩 베이직 쇼츠 78,000원",
      imageUrl: "https://example.com/shorts.jpg",
    }],
    pageText: "전체 1개 브랜드직영몰 1개 백화점 0개 아울렛 0개",
  }), "네이버 공식 브랜드스토어", "TLPOM26699", "코오롱스포츠", "코오롱스포츠 DAYPACK 남성 데이팩 베이직 쇼츠 TLPOM26699");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].articleNumber, "TLPOM26699");
});

test("네이버 결과가 여러 개면 상품명만으로 품번 일치를 추정하지 않는다", () => {
  const card = { productUrl: "https://shopping.naver.com/window-products/1", title: "코오롱스포츠 남성 데이팩 베이직 쇼츠", text: "78,000원" };
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [card, { ...card, productUrl: "https://shopping.naver.com/window-products/2" }], pageText: "전체 2개",
  }), "네이버 공식 브랜드스토어", "TLPOM26699", "코오롱스포츠", "코오롱스포츠 DAYPACK 남성 데이팩 베이직 쇼츠");
  assert.equal(result.count, 0);
});

test("네이버 브랜드직영몰 1개와 같은 브랜드 상품 카드 1개는 품번이 생략돼도 인정한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/brandfashion/124925333777",
      title: "[MLB] 청키 라이너 NY (Off White)",
      text: "MLB 브랜드직영몰 청키 라이너 NY (Off White)",
      imageUrl: "https://example.com/mlb-shoe.jpg",
    }],
    pageText: "전체 2개 브랜드직영몰 1개 백화점 1개 아울렛 0개",
  }), "네이버 공식 브랜드스토어", "3ASXCA12N-50WHS", "MLB", "MLB 차키 내피 합성 가죽 로우탑 스니커즈");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].articleNumber, "3ASXCA12N-50WHS");
});

test("네이버 공식 상품은 상단 1개, 하단 카드 1개, 브랜드직영몰 문구가 모두 필요하다", () => {
  const base = {
    pageText: "전체 1개 브랜드직영몰 1개 백화점 0개 아울렛 0개",
    selectedChannelCount: 1,
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/brandfashion/124925333777",
      title: "[데상트] 흄태준 착용 상품",
      text: "데상트 브랜드직영몰 흄태준 착용 상품",
      officialBrandStoreLabelMatched: true,
    }],
  };
  const verified = analyzeRenderedChannelProducts(
    JSON.stringify(base), "네이버 공식 브랜드스토어", "SR123UPS11", "데상트", "데상트 흄태준 착용 상품",
  );
  assert.equal(verified.count, 1);
  assert.equal(verified.products.length, 1);

  const missingLabel = analyzeRenderedChannelProducts(
    JSON.stringify({ ...base, productCards: [{ ...base.productCards[0], text: "데상트 흄태준 착용 상품", officialBrandStoreLabelMatched: false }] }),
    "네이버 공식 브랜드스토어", "SR123UPS11", "데상트", "데상트 흄태준 착용 상품",
  );
  assert.equal(missingLabel.products.length, 0);
});

test("네이버 백화점과 아울렛도 채널 1개와 같은 브랜드 카드 1개를 인정한다", () => {
  for (const [store, label, path] of [
    ["네이버 백화점", "백화점", "department"],
    ["네이버 아울렛", "아울렛", "outlet"],
  ]) {
    const result = analyzeRenderedChannelProducts(JSON.stringify({
      productCards: [{
        productUrl: `https://shopping.naver.com/window-products/${path}/124925333777`,
        title: "[MLB] 청키 라이너 NY (Off White)",
        text: "MLB 청키 라이너 NY (Off White)",
      }],
      pageText: `전체 1개 ${label} 1개`,
    }), store, "3ASXCA12N-50WHS", "MLB", "MLB 차키 내피 합성 가죽 로우탑 스니커즈");
    assert.equal(result.count, 1, store);
  }
});

test("네이버 아울렛 탭에서 확인된 국내 상품 카드 수를 표시한다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191642",
      title: "아디다스 VL 코트 3.0 클라우드 화이트 코어 블랙",
      text: "아디다스 롯데몰 수지점 89,000원",
    }, {
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191643",
      title: "에스마켓 아디다스 VL COURT 3.0",
      text: "아디다스 NC 야탑점 79,000원",
    }],
    pageText: "전체 6개 아울렛 6개 백화점 0개 소호&스트릿 0개",
  }), "네이버 아울렛", "ID8797", "아디다스", "아디다스 VL 코트 3.0");

  assert.equal(result.count, 2);
  assert.equal(result.channelCount, 6);
  assert.equal(result.presenceConfirmed, true);
  assert.equal(result.absenceConfirmed, false);
});

test("네이버 채널의 원시 결과 수를 화면 값으로 유지한다", () => {
  const positive = analyzeRenderedChannelProducts("전체 6개 아울렛 6개", "네이버 아울렛", "ID8797", "아디다스");
  const empty = analyzeRenderedChannelProducts("전체 0개 아울렛 0개", "네이버 아울렛", "ID8797", "아디다스");
  assert.deepEqual({ count: positive.count, channelCount: positive.channelCount }, { count: 6, channelCount: 6 });
  assert.deepEqual({ count: empty.count, channelCount: empty.channelCount }, { count: 0, channelCount: 0 });
});

test("푸마 392290-03 아울렛 화면의 국내 카드 5개를 그대로 표시한다", () => {
  const productCards = [
    ["13001191641", "푸마 남녀공용 스니커즈 PUMA 케이븐 2.0 392290-03"],
    ["13001191642", "푸마 케이븐 2.0 코트 PKI392290-03"],
    ["13001191643", "푸마 PUMA 푸마 케이븐 2.0 392290-03"],
    ["13001191644", "푸마 소프트라이드 코스믹 운동화"],
    ["13001191645", "푸마 소프트라이드 코스믹 스니커즈"],
  ].map(([id, title]) => ({
    productUrl: `https://shopping.naver.com/window-products/outlet/${id}`,
    title,
    text: `${title} 국내 아울렛 매장`,
  }));
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards,
    pageText: "전체 6개 아울렛 5개 해외직구 1개 백화점 0개",
  }), "네이버 아울렛", "392290-03", "푸마", "푸마 케이븐 2.0 화이트 블랙");

  assert.equal(result.count, 5);
  assert.equal(result.channelCount, 5);
  assert.equal(result.presenceConfirmed, true);
  assert.equal(result.absenceConfirmed, false);
});

test("푸마 공식브랜드 0개 화면의 아울렛 추천 카드는 공식 상품으로 세지 않는다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    selectedChannelEmpty: true,
    selectedChannelCount: 0,
    pageText: "찾으시는 상품과 유사한 상품도 함께 노출합니다. 상품이 없습니다.",
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191641",
      title: "푸마 케이븐 2.0 392290-03",
      text: "ABC마트 아울렛",
    }],
  }), "네이버 공식 브랜드스토어", "392290-03", "푸마", "푸마 케이븐 2.0 화이트 블랙");

  assert.equal(result.count, 0);
  assert.equal(result.absenceConfirmed, true);
  assert.deepEqual(result.products, []);
});

test("네이버 백화점과 아울렛은 다른 채널 상품 링크를 섞지 않는다", () => {
  const cards = [{
    productUrl: "https://shopping.naver.com/window-products/outlet/13001191641",
    title: "푸마 케이븐 2.0 392290-03",
    text: "푸마 아울렛 상품",
  }];
  const department = analyzeRenderedChannelProducts(JSON.stringify({
    selectedChannelCount: 1,
    pageText: "전체 1개 백화점 1개",
    productCards: cards,
  }), "네이버 백화점", "392290-03", "푸마", "푸마 케이븐 2.0 화이트 블랙");
  const outlet = analyzeRenderedChannelProducts(JSON.stringify({
    selectedChannelCount: 1,
    pageText: "전체 1개 아울렛 1개",
    productCards: cards,
  }), "네이버 아울렛", "392290-03", "푸마", "푸마 케이븐 2.0 화이트 블랙");

  assert.equal(department.products.length, 0);
  assert.equal(outlet.products.length, 1);
});

test("네이버 window-products 상품 주소를 화면 수집 대상으로 인식한다", async () => {
  const mainSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../main.mjs", import.meta.url), "utf8"));
  assert.match(mainSource, /window-products/);
});

test("rendered SSG cards take priority over a stale block phrase elsewhere on the page", async () => {
  const mainSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../main.mjs", import.meta.url), "utf8"));
  assert.match(mainSource, /parsedContent\?\.pageBlocked && !parsedContent\?\.productCards\?\.length/);
  assert.match(mainSource, /\[class\*='cunit'\]/);
  assert.match(mainSource, /SEARCH_PAGE_TIMEOUT[\s\S]*30_000/);
  assert.match(mainSource, /persist:around-g-domestic-search/);
});

test("malformed rendered data is a verification failure, not a confirmed zero", () => {
  assert.equal(countRenderedChannelProducts('{"pageText":"partial"}', "SSG 백화점", "IO9554-100", "나이키"), null);
});

test("query metadata repetitions are not counted as products", () => {
  const html = '<meta content="IO9554-100"><title>IO9554-100 검색</title><a href="/help">도움말</a>';
  assert.equal(countLinkedSearchProducts(html, "IO9554-100"), 0);
});

test("domestic search links safely encode a query", () => {
  const query = "나이키 DD1391-100";
  for (const link of Object.values(DOMESTIC_SEARCH_LINKS)) {
    assert.match(link(query), /%20|%EB/);
  }
});

test("Musinsa parser extracts product data", () => {
  const data = {
    props: { pageProps: { dehydratedState: { queries: [
      { state: { data: { pages: [{ items: [{
        goodsNo: 123,
        goodsName: "Air Force 1",
        brandName: "Nike",
        finalPrice: "129,000",
        normalPrice: 149000,
        thumbnail: "https://img.example/1.jpg",
        optionList: [{ optionName: "270", stockQuantity: 2 }, { optionName: "275", stockQuantity: 0 }],
      }] }] } } },
    ] } } },
  };
  const result = parseMusinsaSearch(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
  assert.equal(result.length, 1);
  assert.equal(result[0].store, "무신사");
  assert.equal(result[0].price, 129000);
  assert.deepEqual(result[0].sizes, [
    { label: "270", inStock: true },
    { label: "275", inStock: false },
  ]);
});

test("SSG parser extracts product data", () => {
  const data = {
    props: { pageProps: { dehydratedState: { queries: [
      { state: { data: { areaList: [{
        unitType: "ITEM_UNIT_LIST",
        dataList: [{ itemId: "A1", itemName: "운동화", brandName: "Nike", finalPrice: 119000 }],
      }] } } },
    ] } } },
  };
  const result = parseSsgSearch(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
  assert.equal(result.length, 1);
  assert.equal(result[0].store, "SSG");
  assert.equal(result[0].price, 119000);
});

test("Kolon parser extracts embedded product data", () => {
  const html = String.raw`{"__typename":"productResult","code":"K1","name":"DD1391-100 운동화","supplierBrandName":"Nike","representationImage":"https://img.example/k.jpg","soldOutYn":"N","price":{"price":109000,"wishPrice":139000}}`;
  const result = parseKolonSearch(html, "DD1391-100");
  assert.equal(result.length, 1);
  assert.equal(result[0].store, "코오롱몰");
  assert.equal(result[0].price, 109000);
});

test("one domestic store failure does not stop the others", async () => {
  const emptyNextData = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { dehydratedState: { queries: [] } } },
  })}</script>`;
  const fetchImpl = async (url) => {
    if (String(url).includes("kolonmall.com")) return { ok: false, status: 403, text: async () => "" };
    return { ok: true, status: 200, text: async () => emptyNextData };
  };
  const result = await queryDomesticProducts({ query: "DD1391-100", brand: "나이키", fetchImpl });
  assert.equal(result.sources.length, 13);
  assert.deepEqual(result.sources.map((source) => source.store), [
    "브랜드 공식몰",
    "네이버 공식 브랜드스토어",
    "네이버 백화점",
    "네이버 아울렛",
    "무신사",
    "SSG",
    "SSG 백화점",
    "SSG 아울렛",
    "롯데온",
    "롯데온 백화점",
    "롯데온 아울렛",
    "병행수입·편집샵",
    "코오롱몰",
  ]);
  assert.deepEqual(result.sources.map((source) => source.priority), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(result.sources.find((source) => source.store === "코오롱몰").ok, false);
  assert.equal(result.sources.filter((source) => source.ok).length, 12);
  assert.deepEqual(
    result.sources.filter((source) => source.renderCount).map((source) => source.store),
    ["브랜드 공식몰", "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛", "무신사", "SSG", "SSG 백화점", "SSG 아울렛", "롯데온", "롯데온 백화점", "롯데온 아울렛", "병행수입·편집샵"]
  );
});

test("an unverified brand is not reported as a verified official-store zero", async () => {
  const emptyNextData = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { dehydratedState: { queries: [] } } } })}</script>`;
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => emptyNextData });
  const result = await queryDomesticProducts({ query: "L47581100", brand: "살로몬", fetchImpl });
  const official = result.sources[0];
  assert.equal(official.store, "공식몰 추가 확인 필요");
  assert.equal(official.officialStatus, "pending");
  assert.equal(official.renderCount, false);
  assert.equal(official.officialProductUrl, "");
});

test("a verified official homepage stays usable when product search is unsupported", async () => {
  const result = await queryDomesticProducts({
    query: "L47581100",
    brand: "살로몬",
    officialBrandRecord: {
      status: OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED,
      homepageUrl: "https://salomon.co.kr/",
      searchTemplate: "",
    },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "" }),
  });
  const official = result.sources[0];
  assert.equal(official.store, "브랜드 공식몰");
  assert.equal(official.officialStatus, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED);
  assert.equal(official.homepageUrl, "https://salomon.co.kr/");
  assert.equal(official.officialProductUrl, "");
  assert.equal(official.renderCount, true);
});

test("official-store direct search URL is replaced by homepage magnifier search", async () => {
  const result = await queryDomesticProducts({
    query: "아디다스 IH0274",
    articleNumber: "IH0274",
    brand: "아디다스",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.equal(official.homepageUrl, "https://www.adidas.co.kr/");
  assert.equal(official.officialSearchUrl, "");
  assert.equal(official.officialProductUrl, "");
  assert.equal(official.interactiveSearch, true);
  assert.equal(official.searchQuery, "IH0274");
});

test("official-store text matches without a product-detail URL are discarded", () => {
  const content = JSON.stringify({
    pageText: "데상트 SR123UTS11 검색 결과",
    productCards: [
      { productUrl: "", text: "#SR123UTS11", title: "#SR123UTS11", imageUrl: "" },
      {
        productUrl: "https://dk-on.com/DESCENTE/goods/SR123UTS11",
        text: "SR123UTS11 데상트 반팔 티셔츠",
        title: "데상트 반팔 티셔츠",
        imageUrl: "https://cdn.example/search-card.jpg",
        imageLinkedToProduct: true,
      },
    ],
  });
  const result = analyzeRenderedChannelProducts(content, "브랜드 공식몰", "SR123UTS11", "데상트", "데상트 반팔 티셔츠");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].url, "https://dk-on.com/DESCENTE/goods/SR123UTS11");
  assert.equal(result.products[0].imageVerifiedFromCard, true);
});

test("official-store result cards without a visible model code are opened for exact detail verification", () => {
  const content = JSON.stringify({
    pageText: "SR123UTS15 검색 결과 상품 4",
    productCards: [{
      productUrl: "https://dk-on.com/DESCENTE/goods/detail/12345",
      text: "[세리나 착용] 스몰 워딩 코튼 반팔 티셔츠 블랙",
      title: "스몰 워딩 코튼 반팔 티셔츠",
      imageUrl: "https://cdn.example/black.jpg",
      imageLinkedToProduct: true,
    }],
  });
  const result = analyzeRenderedChannelProducts(content, "브랜드 공식몰", "SR123UTS15", "데상트", "스몰 워딩 코튼 반팔 티셔츠");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].detailArticleVerificationRequired, true);
  assert.equal(result.products[0].detectedArticleNumber, "");
});

test("a transient Musinsa server failure is retried once", async () => {
  const dataWithOneProduct = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { dehydratedState: { queries: [
      { state: { data: { pages: [{ items: [{ goodsNo: 501, goodsName: "TEST-501 재시도 상품" }] }] } } },
    ] } } },
  })}</script>`;
  const emptyData = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { dehydratedState: { queries: [] } } } })}</script>`;
  let musinsaCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("musinsa.com/search/goods")) {
      musinsaCalls += 1;
      if (musinsaCalls === 1) return { ok: false, status: 503, text: async () => "" };
      return { ok: true, status: 200, text: async () => dataWithOneProduct };
    }
    if (String(url).includes("api.musinsa.com")) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, text: async () => emptyData };
  };
  const result = await queryDomesticProducts({ query: "TEST-501", articleNumber: "TEST-501", fetchImpl });
  assert.equal(musinsaCalls, 2);
  assert.equal(result.sources.find((source) => source.store === "무신사")?.count, 1);
});

test("SSG Descente official brand hall outranks edit-shop discovery classification", () => {
  assert.equal(isSsgOfficialBrandHall({
    brand: "데상트",
    url: "https://www.ssg.com/item/itemView.ssg?itemId=1000833166393",
    text: "본사직영 데상트 브랜드관 [데상트 공식] 데상트 공식브랜드관",
  }), true);

  const rendered = JSON.stringify({
    pageText: "",
    productCards: [{
      productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000833166393",
      title: "[데상트 공식] 터프 스몰 워딩 폴로 반팔 티셔츠 SR323UPS74",
      text: "본사직영 데상트 브랜드관 데상트 공식브랜드관 SR323UPS74",
      markup: "<span>브랜드관</span>",
    }],
  });
  const result = analyzeRenderedChannelProducts(rendered, "병행수입·편집샵", "SR323UPS74", "데상트");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].store, "SSG 브랜드 공식관");
  assert.equal(result.products[0].retailerName, "브랜드 공식관 · 본사직영");
  assert.equal(result.products[0].officialStoreVerified, true);
});

test("SSG official classification requires a listed brand and official evidence", () => {
  assert.equal(isSsgOfficialBrandHall({ brand: "데상트", url: "https://www.ssg.com/item/1", text: "일반 판매상품 데상트" }), false);
  assert.equal(isSsgOfficialBrandHall({ brand: "임의브랜드", url: "https://www.ssg.com/item/1", text: "본사직영 브랜드관" }), false);
  assert.equal(isSsgOfficialBrandHall({ brand: "데상트", url: "https://example.com/item/1", text: "본사직영 데상트 브랜드관" }), false);
});
