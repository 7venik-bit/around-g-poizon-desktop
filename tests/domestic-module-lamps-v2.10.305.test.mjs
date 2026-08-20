import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [menu, css, preload, main] = await Promise.all([
  readFile(new URL("../src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../src/search-service-menu.css", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
]);

test("메뉴 버튼 아래에 일곱 검색 모듈의 작은 상태 램프를 표시한다", () => {
  assert.match(menu, /\["official", "공식몰"\]/);
  assert.match(menu, /\["musinsa", "무신사"\]/);
  assert.match(menu, /\["naver", "네이버"\]/);
  assert.match(menu, /\["ssg", "SSG"\]/);
  assert.match(menu, /\["lotte", "롯데"\]/);
  assert.match(menu, /\["parallel", "병행"\]/);
  assert.match(menu, /\["kolon", "코오롱"\]/);
  assert.match(menu, /data-module-lamp="\$\{id\}"/);
  assert.match(css, /\.module-lamp\.running/);
  assert.match(css, /\.module-lamp\.success/);
  assert.match(css, /\.module-lamp\.failed/);
});

test("검색 모듈 실행 상태를 메인에서 메뉴 램프로 전달한다", () => {
  assert.match(main, /domestic-search:module-status/);
  assert.match(preload, /onDomesticModuleStatus/);
  assert.match(menu, /onDomesticModuleStatus/);
});

test("실패 램프는 원인과 시간을 보여주고 해당 모듈만 다시 검색한다", async () => {
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
  assert.match(menu, /payload\.durationMs/);
  assert.match(menu, /domestic-module:retry/);
  assert.match(menu, /이 모듈만 다시 검색할까요/);
  assert.match(renderer, /modules: moduleIds/);
  assert.match(renderer, /addEventListener\("domestic-module:retry"/);
  assert.match(relay, /requestedModules\.has\(source\.module\)/);
});
