import test from "node:test";
import assert from "node:assert/strict";
import {
  DOMESTIC_SEARCH_LINKS,
  OFFICIAL_BRAND_SEARCH,
  analyzeRenderedChannelProducts,
  countLinkedSearchProducts,
  countRenderedChannelProducts,
  domesticChannelUrl,
  exactArticleIdentityMatch,
  naverFashionTownUrl,
  officialBrandProductSearchUrl,
  officialBrandSearchUrl,
  parseKolonSearch,
  parseMusinsaSearch,
  parseSsgSearch,
  queryDomesticProducts,
} from "../relay/domestic-search.mjs";
import { OFFICIAL_DOMAIN_STATUS } from "../services/official-domain-registry.mjs";

test("every catalog brand uses the Fashion Town brand-store search without an official-mall keyword", () => {
  const url = decodeURIComponent(officialBrandSearchUrl("살로몬", "L47581100"));
  assert.match(url, /shopping\.naver\.com\/window\/search\/fashion-group/);
  assert.match(url, /살로몬/);
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
    ["lotte-department", /mallFilter=.*%EB%B0%B1%ED%99%94%EC%A0%90/],
    ["lotte-outlet", /mallFilter=.*%EC%95%84%EC%9A%B8%EB%A0%9B/],
  ];
  for (const [channel, expected] of cases) {
    const url = domesticChannelUrl(channel, "온", "3ME10100264");
    assert.match(url, expected);
    assert.match(decodeURIComponent(url), /온 3ME10100264/);
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

test("SSG department Korean brand result confirms stock for an English brand query", () => {
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
  assert.equal(result?.products[0]?.inStock, true);
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
    if (String(url).includes("ssg.com")) return { ok: false, status: 403, text: async () => "" };
    return { ok: true, status: 200, text: async () => emptyNextData };
  };
  const result = await queryDomesticProducts({ query: "DD1391-100", brand: "나이키", fetchImpl });
  assert.equal(result.sources.length, 11);
  assert.deepEqual(result.sources.map((source) => source.store), [
    "브랜드 공식몰",
    "네이버 공식 브랜드스토어",
    "네이버 백화점",
    "네이버 아울렛",
    "무신사",
    "SSG 백화점",
    "SSG 아울렛",
    "롯데온 백화점",
    "롯데온 아울렛",
    "SSG",
    "코오롱몰",
  ]);
  assert.deepEqual(result.sources.map((source) => source.priority), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(result.sources.find((source) => source.store === "SSG").ok, false);
  assert.equal(result.sources.filter((source) => source.ok).length, 10);
  assert.deepEqual(
    result.sources.filter((source) => source.renderCount).map((source) => source.store),
    ["브랜드 공식몰", "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛", "무신사", "SSG 백화점", "SSG 아울렛", "롯데온 백화점", "롯데온 아울렛"]
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

test("official-store search and verified product-detail URLs remain distinct", async () => {
  const result = await queryDomesticProducts({
    query: "아디다스 IH0274",
    articleNumber: "IH0274",
    brand: "아디다스",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.match(official.officialSearchUrl, /adidas\.co\.kr\/search/);
  assert.equal(official.officialProductUrl, official.officialSearchUrl);
});

test("a transient Musinsa server failure is retried once", async () => {
  const dataWithOneProduct = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { dehydratedState: { queries: [
      { state: { data: { pages: [{ items: [{ goodsNo: 501, goodsName: "재시도 상품" }] }] } } },
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
