import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("네이버 채널 숫자 글자의 실제 클릭 컨테이너를 찾아 물리적으로 누른다", () => {
  assert.match(mainSource, /async function clickNaverShoppingChannel/);
  assert.match(mainSource, /document\.querySelectorAll\('body \*'\)/);
  assert.ok(mainSource.includes("new RegExp('^' + compact(label) + '[\\\\\\\\d,]+개$')"));
  assert.match(mainSource, /const clickSurface = \(element\) =>/);
  assert.match(mainSource, /node\.tabIndex >= 0 \|\| typeof node\.onclick === 'function' \|\| style\.cursor === 'pointer'/);
  assert.match(mainSource, /surface\.scrollIntoView/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseUp"/);
});

test("숫자 탭의 선택 상태를 글자와 상위 컨테이너에서 함께 확인한다", () => {
  assert.match(mainSource, /const selectedEvidence = \(element\) =>/);
  assert.match(mainSource, /depth < 6[\s\S]*node = node\.parentElement/);
  assert.match(mainSource, /background\[0\] \+ background\[1\] \+ background\[2\] < 300/);
  assert.match(mainSource, /selected: selectedEvidence\(element\) \|\| selectedEvidence\(surface\)/);
  assert.match(mainSource, /const selected = resultTabs\.some\(selectedEvidence\)/);
});

test("채널 선택 성공 뒤 하단 상품 카드를 클릭하고 옵션과 재고를 확인한다", () => {
  assert.match(
    mainSource,
    /if \(naverChannelClickRequired\)[\s\S]*if \(!channelSelected\)[\s\S]*const productLinks[\s\S]*clickRenderedProductCard\(searchWindow, product\.url, resolvedSearchUrl\)[\s\S]*openRenderedSizeOptions\(searchWindow\)/,
  );
});

test("선택 행 일괄 검색은 같은 브랜드와 품번 결과를 재사용한다", () => {
  assert.match(rendererSource, /async function searchExcelPreviewProduct\(key, \{ forceRefresh = true \} = \{\}\)/);
  assert.match(rendererSource, /if \(forceRefresh\) clearDomesticIdentityCache\(product\)/);
  assert.match(rendererSource, /if \(domesticIdentitySearchCache\.has\(identity\)\) return domesticIdentitySearchCache\.get\(identity\)/);
  assert.match(rendererSource, /await searchExcelPreviewProduct\(key, \{ forceRefresh: false \}\)/);
  assert.ok((rendererSource.match(/forceRefresh: false/g) || []).length >= 2);
});
