import test from "node:test";
import assert from "node:assert/strict";
import {
  DOMESTIC_SEARCH_LINKS,
  countRenderedChannelProducts,
  parseKolonSearch,
  parseMusinsaSearch,
  parseSsgSearch,
  queryDomesticProducts,
} from "../relay/domestic-search.mjs";

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
  const result = await queryDomesticProducts({ query: "DD1391-100", fetchImpl });
  assert.equal(result.sources.length, 7);
  assert.deepEqual(result.sources.map((source) => source.store), [
    "브랜드 공식몰",
    "무신사",
    "네이버 브랜드직영몰",
    "네이버 백화점",
    "네이버 아울렛",
    "SSG",
    "코오롱몰",
  ]);
  assert.deepEqual(result.sources.map((source) => source.priority), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.sources.find((source) => source.store === "SSG").ok, false);
  assert.equal(result.sources.filter((source) => source.ok).length, 6);
});
