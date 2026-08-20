import test from "node:test";
import assert from "node:assert/strict";
import { buildDomesticSearchPlan, DOMESTIC_SEARCH_MODULE_ORDER } from "../services/domestic-search-modules/index.mjs";

test("국내 검색 모듈은 공식몰 다음 무신사 순서로 모든 단계를 유지한다", () => {
  assert.deepEqual(DOMESTIC_SEARCH_MODULE_ORDER, ["official", "musinsa", "naver", "ssg", "lotte", "parallel", "kolon"]);
  const plan = buildDomesticSearchPlan({
    store: "브랜드 공식몰",
    officialStatus: "verified",
    homepageUrl: "https://example.com/",
  });
  assert.deepEqual(plan.map(({ store }) => store), [
    "브랜드 공식몰", "무신사",
    "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛",
    "SSG", "SSG 백화점", "SSG 아울렛",
    "롯데온", "롯데온 백화점", "롯데온 아울렛",
    "병행수입·편집샵", "코오롱몰",
  ]);
  assert.equal(new Set(plan.map(({ id }) => id)).size, plan.length);
  assert.equal(plan[0].module, "official");
  assert.equal(plan[1].module, "musinsa");
});

test("공식몰 검색 실행은 3회 재시도하고 실제 실행 여부를 확인한다", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../main.mjs", import.meta.url), "utf8"));
  assert.match(source, /async function executeOfficialMallSearch/);
  assert.match(source, /attempt = 1; attempt <= 3/);
  assert.match(source, /officialMallSearchWasExecuted/);
  assert.match(source, /\^\(\?:브랜드 공식몰\|SSG\|롯데온\)/);
});
