import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const context = createContext({ console });
runInContext(readFileSync(new URL("../src/article-representative.js", import.meta.url), "utf8"), context);
const api = context.AroundGArticleRepresentative;
const plain = (value) => JSON.parse(JSON.stringify(value));

const row = (key, articleNumber, price, brand = "나이키") => ({
  key,
  product: { articleNumber, brandName: brand, averagePrice: price },
});

test("same article keeps only the highest-price row for search", () => {
  const r = plain(api.selectArticlePriceRepresentatives([
    row("k1", "DD1503-101", 75000),
    row("k2", "DD1503-101", 101000),
    row("k3", "DD1503-101", 94000),
  ]));
  assert.deepEqual(r.representativeKeys, ["k2"]);
  assert.deepEqual(r.representativeOf, { k1: "k2", k2: "k2", k3: "k2" });
  assert.deepEqual(r.skippedKeys, ["k1", "k3"]);
});

test("different articles each keep their own representative", () => {
  const r = plain(api.selectArticlePriceRepresentatives([
    row("k1", "DD1503-101", 75000),
    row("k2", "KD8313", 50000),
  ]));
  assert.deepEqual(new Set(r.representativeKeys), new Set(["k1", "k2"]));
  assert.deepEqual(r.skippedKeys, []);
});

test("price ties keep the first row and rows without article are never skipped", () => {
  const r = plain(api.selectArticlePriceRepresentatives([
    row("k1", "DD1503-101", 90000),
    row("k2", "DD1503-101", 90000),
    { key: "k3", product: { title: "no code", averagePrice: 999 } },
  ]));
  assert.deepEqual(new Set(r.representativeKeys), new Set(["k1", "k3"]));
  assert.deepEqual(r.skippedKeys, ["k2"]);
});

test("same article from another brand is not dropped", () => {
  const r = plain(api.selectArticlePriceRepresentatives([
    row("k1", "DD1503-101", 75000, "나이키"),
    row("k2", "DD1503-101", 101000, "아디다스"),
  ]));
  assert.deepEqual(new Set(r.representativeKeys), new Set(["k1", "k2"]));
  assert.deepEqual(r.skippedKeys, []);
});

test("raw workbook price text is parsed when the numeric price is missing", () => {
  const r = plain(api.selectArticlePriceRepresentatives([
    { key: "k1", product: { articleNumber: "DD1503-101", brandName: "나이키", originalValues: { averagePrice: "KRW75,000" } } },
    { key: "k2", product: { articleNumber: "DD1503-101", brandName: "나이키", originalValues: { averagePrice: "KRW101,000" } } },
  ]));
  assert.deepEqual(r.representativeKeys, ["k2"]);
  assert.equal(api.articleRowPrice({}), 0);
});

test("renderer wires representative filtering into row and bulk search", async () => {
  const { readFile } = await import("node:fs/promises");
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(renderer, /AroundGArticleRepresentative/);
  assert.match(renderer, /selectArticlePriceRepresentatives/);
  assert.match(renderer, /typeof articleRepresentativePlan === "function"/);
  assert.match(renderer, /typeof articleRepresentativeSkipReason === "function"/);
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /article-representative\.js/);
});
