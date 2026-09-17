import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("수동 공식몰 열기는 보이는 창에서 DOM 준비 즉시 시작한다", () => {
  assert.match(main, /async function loadOfficialPageForAutomation/);
  assert.match(main, /(?:webContents|contents)\.once\("dom-ready", onReady\)/);
  const source = main.slice(main.indexOf("async function openOfficialMallInternalSearch"), main.indexOf("async function waitForDomesticCaptureReady"));
  assert.match(source, /show: true/);
  assert.match(main, /loadOfficialPageForAutomation\(searchWindow, homepage\.href\)/);
});

test("수동 공식몰 창은 검색 성공 여부와 관계없이 표시한다", () => {
  const start = main.indexOf("async function openOfficialMallInternalSearch");
  const end = main.indexOf("async function loadNaverFashionTownResultPage", start);
  const source = main.slice(start, end);
  assert.match(source, /if \(!submitted\)[\s\S]*?searchWindow\.show\(\)[\s\S]*?searchWindow\.focus\(\)/);
  assert.doesNotMatch(source, /searchWindow\.hide\(\)/);
});
