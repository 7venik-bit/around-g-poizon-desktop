import test from "node:test";
import assert from "node:assert/strict";
import {
  DOMESTIC_SEARCH_LINKS,
  parseKolonSearch,
  parseMusinsaSearch,
  parseSsgSearch,
  queryDomesticProducts,
} from "../relay/domestic-search.mjs";

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
      }] }] } } },
    ] } } },
  };
  const result = parseMusinsaSearch(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
  assert.equal(result.length, 1);
  assert.equal(result[0].store, "무신사");
  assert.equal(result[0].price, 129000);
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
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources.find((source) => source.store === "SSG").ok, false);
  assert.equal(result.sources.filter((source) => source.ok).length, 2);
});
