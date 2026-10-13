import test from "node:test";
import assert from "node:assert/strict";
import { parseNaverWindowProductData } from "../services/domestic-detail-page.mjs";

const product = (id, extra = "") => `{"menus":[{"title":"기획전"}],"product":{"id":"${id}",`
  + `"name":"[ABC마트] ADIDAS 슈퍼스타 II 주니어 스니커즈 JH9976",`
  + `"salePrice":119000,"channel":{"channelName":"ABC마트"},`
  + `"naverShoppingSearchInfo":{"modelName":"JH9976"},${extra}`
  + `"optionCombinations":[{"optionName1":"220","stockQuantity":29},`
  + `{"optionName1":"225","stockQuantity":0},{"optionName1":"230","stockQuantity":30}]}}`;

test("embedded window product data yields exact sizes and identity", () => {
  const parsed = parseNaverWindowProductData(`<html><body>${product("13655477659")}</body></html>`, "13655477659");
  assert.ok(parsed);
  assert.equal(parsed.id, "13655477659");
  assert.match(parsed.name, /JH9976/);
  assert.equal(parsed.modelCode, "JH9976");
  assert.equal(parsed.salePrice, 119000);
  assert.equal(parsed.channelName, "ABC마트");
  assert.deepEqual(parsed.options.map((option) => [option.label, option.inStock, option.quantity]),
    [["220", true, 29], ["225", false, 0], ["230", true, 30]]);
});

test("embedded data binds to the requested product id only", () => {
  const html = `<html><body>${product("111")}${product("13655477659")}</body></html>`;
  assert.equal(parseNaverWindowProductData(html, "13655477659").id, "13655477659");
  assert.equal(parseNaverWindowProductData(html, "999999999"), null);
  assert.equal(parseNaverWindowProductData(html, ""), null);
});

test("malformed embedded data never throws", () => {
  assert.equal(parseNaverWindowProductData("", "13655477659"), null);
  assert.equal(parseNaverWindowProductData("<html></html>", "13655477659"), null);
  assert.equal(parseNaverWindowProductData('{"product":{"id":', "13655477659"), null);
  assert.equal(parseNaverWindowProductData('{"product":{"id":"13655477659"}}', "13655477659").options.length, 0);
});
