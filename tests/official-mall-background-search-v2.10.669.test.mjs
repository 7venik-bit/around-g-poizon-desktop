import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("공식몰 내부 자동 검색은 숨은 창에서 DOM 준비 즉시 시작한다", () => {
  assert.match(main, /async function loadOfficialPageForAutomation/);
  assert.match(main, /webContents\.once\("dom-ready", onReady\)/);
  assert.match(main, /async function openOfficialMallInternalSearch[\s\S]*?show: false/);
  assert.match(main, /loadOfficialPageForAutomation\(searchWindow, homepage\.href\)/);
});

test("자동 검색 실패 때만 공식몰 창을 전면에 표시한다", () => {
  const start = main.indexOf("async function openOfficialMallInternalSearch");
  const end = main.indexOf("async function loadNaverFashionTownResultPage", start);
  const source = main.slice(start, end);
  assert.match(source, /if \(!submitted\)[\s\S]*?searchWindow\.show\(\)[\s\S]*?searchWindow\.focus\(\)/);
  assert.match(source, /else \{\s*searchWindow\.hide\(\)/);
});
