import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("seller search input is retried across frames and localized controls", () => {
  assert.match(main, /searchInputAttempt <= 4/);
  assert.match(main, /sellerWindowFrames\(\)/);
  assert.match(main, /sellerProductFrameRoutingId = candidate\.frame\.routingId/);
  assert.match(main, /상품\|상품명\|브랜드\|품번\|검색\|product\|brand\|article\|spu\|sku\|商品\|品牌\|货号\|搜索\|查询/);
  assert.match(main, /판매자센터 검색 입력창이 아직 표시되지 않아 상품검색 화면을 다시 열고 재시도합니다/);
  assert.match(main, /SELLER_LOGIN_REQUIRED/);
});

test("a failed brand keeps the remaining selected brand queue", () => {
  assert.match(renderer, /다음 \$\{remainingCount\}개 브랜드 작업을 계속합니다/);
  assert.match(renderer, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 900\)/);
  assert.doesNotMatch(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);
});

test("release metadata is 2.10.82", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.82");
  assert.equal(JSON.parse(lockSource).version, "2.10.82");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.82");
});
