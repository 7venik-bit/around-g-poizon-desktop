import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("공식몰 로딩 중 창이 닫히면 대기 작업을 즉시 안전하게 종료한다", () => {
  const start = main.indexOf("async function loadOfficialPageForAutomation");
  const end = main.indexOf("function closedInternalSearchResult", start);
  const source = main.slice(start, end);

  assert.match(source, /const contents = searchWindow\.webContents/);
  assert.match(source, /const onClosed = \(\) => finish\(false\)/);
  assert.match(source, /searchWindow\.once\("closed", onClosed\)/);
  assert.match(source, /contents\.removeListener\("dom-ready", onReady\)/);
  assert.match(source, /contents\.removeListener\("did-fail-load", onFailed\)/);
  assert.doesNotMatch(source, /searchWindow\.webContents\.removeListener/);
});

test("공식몰 결과 수집 뒤에도 창 생존 여부를 다시 확인한다", () => {
  const start = main.indexOf("async function openOfficialMallInternalSearch");
  const end = main.indexOf("async function waitForDomesticCaptureReady", start);
  const source = main.slice(start, end);

  assert.match(
    source,
    /const products = submitted \? await collectOfficialMallSearchProducts\(searchWindow, exactQuery\) : \[\];\s+if \(!browserWindowUsable\(searchWindow\)\) return closedInternalSearchResult\(stage\)/,
  );
});
