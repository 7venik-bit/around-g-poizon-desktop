import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMESTIC_RETAILER_GROUPS, domesticChannelUrl } from "../relay/domestic-search.mjs";

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("general LotteON and SSG searches are checked in addition to department and outlet scopes", () => {
  assert.match(domesticChannelUrl("lotte-general", "나이키", "CW2288-001"), /lotteon\.com\/search/);
  assert.match(domesticChannelUrl("ssg-general", "나이키", "CW2288-001"), /ssg\.com\/search/);
  assert.ok(relay.includes('store: "롯데온"'));
  assert.ok(relay.includes('store: "SSG"'));
});

test("editorial and parallel-import seller catalogs participate in discovery", () => {
  const editorial = DOMESTIC_RETAILER_GROUPS["온라인 편집샵"];
  const parallel = DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"];
  for (const name of ["OK몰", "카시나", "29CM", "무신사", "W컨셉", "EQL", "하이츠스토어"]) assert.ok(editorial.includes(name));
  for (const name of ["인퓨전프로젝트", "다움스포츠", "트렌드메카", "라벨루쏘", "구템즈", "FABSTYLE"]) assert.ok(parallel.includes(name));
  assert.ok(relay.includes('store: "병행수입·편집샵"'));
  assert.ok(relay.includes("retailerName"));
  assert.ok(relay.includes("parallelImportCompanies:"));
  assert.ok(relay.includes("queryCandidates[0]"));
});

test("병행수입업체는 전용 칸과 업체별 상품 소싱 버튼으로 표시된다", () => {
  assert.ok(renderer.includes("parallel-import-panel"));
  assert.ok(renderer.includes(">병행수입업체<"));
  assert.ok(renderer.includes("parallelImportLinks"));
  assert.ok(renderer.includes(">상품 소싱<"));
  assert.ok(style.includes(".parallel-import-panel"));
});

test("a zero is confirmed only when the store page explicitly says no results", () => {
  assert.ok(relay.includes("absenceConfirmed: true"));
  assert.ok(relay.includes("absenceConfirmed: false"));
});
