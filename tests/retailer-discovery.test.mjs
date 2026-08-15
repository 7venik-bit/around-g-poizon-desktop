import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMESTIC_RETAILER_GROUPS, domesticChannelUrl } from "../relay/domestic-search.mjs";

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");

test("general LotteON and SSG searches are checked in addition to department and outlet scopes", () => {
  assert.match(domesticChannelUrl("lotte-general", "나이키", "CW2288-001"), /lotteon\.com\/search/);
  assert.match(domesticChannelUrl("ssg-general", "나이키", "CW2288-001"), /ssg\.com\/search/);
  assert.match(relay, /store: "롯데온"/);
  assert.match(relay, /store: "SSG"/);
});

test("editorial and parallel-import seller catalogs participate in discovery", () => {
  const editorial = DOMESTIC_RETAILER_GROUPS["온라인 편집샵"];
  const parallel = DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"];
  for (const name of ["OK몰", "카시나", "29CM", "무신사", "W컨셉", "EQL", "하이츠스토어"]) assert.ok(editorial.includes(name));
  for (const name of ["인퓨전프로젝트", "다움스포츠", "트렌드메카", "라벨루쏘", "구템즈", "FABSTYLE"]) assert.ok(parallel.includes(name));
  assert.match(relay, /store: "병행수입·편집샵"/);
  assert.match(relay, /retailerName/);
});

test("a zero is confirmed only when the store page explicitly says no results", () => {
  assert.match(relay, /absenceConfirmed: true/);
  assert.match(relay, /absenceConfirmed: false/);
});
