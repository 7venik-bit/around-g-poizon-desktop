import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("rendered searches preserve the exact failure stage instead of returning null", () => {
  assert.match(main, /function renderedSearchFailure/);
  assert.match(main, /security_verification_required/);
  assert.match(main, /fashion_town_click_failed/);
  assert.match(main, /search_submission_failed/);
  assert.match(main, /channel_selection_failed/);
  assert.match(main, /official_filter_failed/);
  assert.match(main, /verificationReason: String\(result\?\.verificationReason/);
});

test("the UI separates security, login, connection and completed absence states", () => {
  assert.match(renderer, /보안 확인 필요/);
  assert.match(renderer, /로그인 필요/);
  assert.match(renderer, /패션타운 진입 실패/);
  assert.match(renderer, /검색 입력 실패/);
  assert.match(renderer, /상품코드→상품명→상품명\+상품코드 순서로 검색을 완료/);
  assert.doesNotMatch(renderer, /label: "다시 검색 필요"/);
});

test("unknown stock is not displayed as sold out", () => {
  assert.match(renderer, /matchedProducts\.every\(\(product\) => product\.inStock === false\)/);
  assert.match(renderer, /재고·사이즈 확인 필요/);
});

test("official mall submits a product query once without homepage reload retries", () => {
  const execution = main.match(/async function executeOfficialMallSearch[\s\S]*?\r?\n}\r?\n\r?\nfunction renderedSearchFailure/)?.[0] || "";
  assert.match(execution, /const submitted = await submitOfficialMallSearch/);
  assert.doesNotMatch(execution, /for \(let attempt/);
  assert.doesNotMatch(execution, /loadURL\(homepageUrl\)/);
});
