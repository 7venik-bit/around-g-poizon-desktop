import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMESTIC_RETAILER_GROUPS, detectedParallelImportRetailer, domesticChannelUrl } from "../relay/domestic-search.mjs";

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("general LotteON and SSG searches are checked in addition to department and outlet scopes", () => {
  assert.match(domesticChannelUrl("lotte-general", "나이키", "CW2288-001"), /lotteon\.com\/csearch\/search\/search/);
  assert.match(domesticChannelUrl("ssg-general", "나이키", "CW2288-001"), /ssg\.com\/search/);
  assert.ok(relay.includes('store: "롯데온"'));
  assert.ok(relay.includes('store: "SSG"'));
});

test("editorial and parallel-import seller catalogs participate in discovery", () => {
  const editorial = DOMESTIC_RETAILER_GROUPS["온라인 편집샵"];
  const parallel = DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"];
  for (const name of ["OK몰", "카시나", "29CM", "무신사", "W컨셉", "EQL", "하이츠스토어"]) assert.ok(editorial.includes(name));
  for (const name of ["인퓨전프로젝트", "브릭맨션", "다옴스포츠", "한아아이앤티", "대림코퍼레이션", "DLC", "베이지크", "소노몰", "라벨르쏘", "구템즈", "FABSTYLE"]) assert.ok(parallel.includes(name));
  for (const rejectedTypo of ["다움스포츠", "한아이엔티", "베이지2", "소호몰", "라벨루쏘", "베이직"]) assert.equal(parallel.includes(rejectedTypo), false);
  assert.ok(relay.includes('store: "병행수입·편집샵"'));
  assert.ok(relay.includes("retailerName"));
  assert.ok(relay.includes("parallelImportCompanies: []"));
  assert.ok(relay.includes("queryCandidates[0]"));
});

test("병행수입 허용 명단은 사용자 제공 28개 업체와 두 별칭만 인정한다", () => {
  const parallel = DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"];
  const canonical = parallel.filter((name) => !["브릭맨션", "DLC"].includes(name));
  assert.equal(canonical.length, 28);
  for (const name of canonical) assert.match(detectedParallelImportRetailer(name), /병행수입 정품업체/);
  assert.equal(detectedParallelImportRetailer("브릭맨션"), "병행수입 정품업체 · 인퓨전프로젝트");
  assert.equal(detectedParallelImportRetailer("DLC"), "병행수입 정품업체 · 대림코퍼레이션");
  for (const name of ["ABC마트", "명단외판매자", "알수없는 병행수입몰"]) {
    assert.equal(detectedParallelImportRetailer(name), "");
  }
});

test("병행수입 명단 불일치 결과는 화면에서 상품없음으로 표시한다", async () => {
  const inline = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
  assert.match(inline, /approvedParallelMissing/);
  assert.match(inline, /\? "상품없음"/);
  assert.match(inline, /parallelRetailerVerified === true/);
});

test("병행수입업체는 정확한 모델 상품만 리스트에 표시하고 명단 불일치는 상품없음 처리한다", async () => {
  const inline = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
  assert.ok(renderer.includes('source.store === "병행수입·편집샵"'));
  assert.ok(renderer.includes("parallelRetailerListEnforced"));
  assert.ok(inline.includes("approvedParallelMissing"));
  assert.ok(inline.includes('parallelRetailerVerified === true'));
  assert.ok(renderer.includes('source.store === "병행수입·편집샵" ? "상품 소싱"'));
});

test("a zero is confirmed only when the store page explicitly says no results", () => {
  assert.ok(relay.includes("absenceConfirmed: true"));
  assert.ok(relay.includes("absenceConfirmed: false"));
});
