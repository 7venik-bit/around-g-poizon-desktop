import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("Naver sourcing starts at Naver home instead of a direct Shopping URL", () => {
  assert.match(mainSource, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/" : url/);
  assert.doesNotMatch(mainSource, /const initialUrl = naverPortalSource \? "https:\/\/shopping\.naver\.com/);
});

test("the visible Naver Shopping menu is physically clicked and its new tab is reused", () => {
  assert.match(mainSource, /async function clickNaverShoppingHomeMenu/);
  assert.match(mainSource, /compact\(element\.textContent\) === "쇼핑"/);
  assert.match(mainSource, /shopping\\\.naver\\\.com\\\/ns\\\/home/);
  assert.match(mainSource, /sendInputEvent\(\{ type: "mouseDown", x: target\.x, y: target\.y/);
  assert.match(mainSource, /setWindowOpenHandler\(\(\{ url: popupUrl \}\)/);
  assert.match(mainSource, /searchWindow\.loadURL\(popupUrl\)/);
  assert.match(mainSource, /\^https:\\\/\\\/shopping\\\.naver\\\.com\\\/ns\\\/home/);
});

test("Shopping home must open before Fashion Town and product-code submission", () => {
  assert.match(
    mainSource,
    /clickNaverShoppingHomeMenu\(searchWindow\)[\s\S]*clickNaverFashionTownMenu\(searchWindow\)[\s\S]*submitNaverShoppingSearch\(searchWindow, searchQuery\)/,
  );
  assert.match(mainSource, /securityRequired \? "security_verification_required" : "naver_shopping_click_failed"/);
  assert.match(mainSource, /const fashionLabels = \["패션타운", "패션위크"\]/);
  assert.match(mainSource, /label\.includes\(fashionLabel\)/);
  assert.doesNotMatch(mainSource, /label === "패션위크" && \/fashion-group\/i\.test\(href\)/);
});
