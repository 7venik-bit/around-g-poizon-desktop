import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { beginLiveVerification } from "../src/poizon-review-workspace.js";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function setup(onRetry) {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", { url: "https://example.test/" });
  const doc = dom.window.document;
  const api = {
    onSellerVerificationProgress: () => () => {},
    endSellerExcelVerification: async () => {},
  };
  const view = beginLiveVerification({
    file: { path: "test.xlsx", name: "test.xlsx" },
    brandName: "TEST",
    snapshot: { products: [], headers: [] },
    conditions: {},
    api,
    doc,
    ...(onRetry === undefined ? {} : { onRetry }),
  });
  return { doc, view };
}

test("a stopped verification offers a restart button when the starter provides one", async () => {
  let retried = 0;
  const { doc, view } = setup(async () => { retried += 1; });
  view.finish({ ok: false, message: "페이지 상품 수와 대조 증거 수가 달라 Excel 수정을 중단했습니다." });
  const button = doc.querySelector(".review-retry");
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "다시 시작");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(retried, 1);
  view.dispose();
});

test("no restart button without a starter entry point", () => {
  const { doc, view } = setup();
  view.finish({ ok: false, message: "중단됨" });
  assert.equal(doc.querySelector(".review-retry").hidden, true);
  view.dispose();
});

test("a completed verification never offers a restart", () => {
  const { doc, view } = setup(async () => {});
  view.finish({ ok: true, corrected: true, changedRows: 1, addedRows: 0 });
  assert.equal(doc.querySelector(".review-retry").hidden, true);
  view.dispose();
});

test("brand verification restarts the same file list from a fresh read", () => {
  const start = renderer.indexOf("async function openVerifiedCombinedBrandPreview(files, filters = {})");
  const end = renderer.indexOf("async function openCombinedSelectedBrandPreview(", start);
  const starter = renderer.slice(start, end);
  assert.match(starter, /onRetry: \(\) => openVerifiedCombinedBrandPreview\(files, filters\)/);
});
