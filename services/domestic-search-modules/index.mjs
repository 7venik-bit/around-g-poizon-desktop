import { officialSearchModule } from "./official.mjs";
import { musinsaSearchModule } from "./musinsa.mjs";
import { naverSearchModule } from "./naver.mjs";
import { ssgSearchModule } from "./ssg.mjs";
import { lotteSearchModule } from "./lotte.mjs";
import { parallelSearchModule } from "./parallel.mjs";
import { kolonSearchModule } from "./kolon.mjs";

export const DOMESTIC_SEARCH_MODULE_ORDER = Object.freeze([
  "official", "musinsa", "naver", "ssg", "lotte", "parallel", "kolon",
]);

export function buildDomesticSearchPlan(official = {}) {
  return [
    ...officialSearchModule(official),
    ...musinsaSearchModule(),
    ...naverSearchModule(),
    ...ssgSearchModule(),
    ...lotteSearchModule(),
    ...parallelSearchModule(),
    ...kolonSearchModule(),
  ];
}
