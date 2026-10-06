import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

const fnStart = main.indexOf("async function renderedSearchSourceResult(");
const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
const collection = main.slice(fnStart, fnEnd);

test("lotte server payload is read from the logged-in session window first", () => {
  const blockStart = collection.indexOf('String(source.store || "") === "롯데온"');
  assert.ok(blockStart >= 0, "lotte server fallback block missing");
  const block = collection.slice(blockStart, collection.indexOf("const analyzed = analyzeRenderedChannelProducts(content", blockStart));
  assert.match(block, /document\.documentElement \? document\.documentElement\.outerHTML/);
  assert.match(block, /parseLotteInitialDataProducts\(String\(sessionHtml/);
  assert.match(block, /origin: "session-dom"/);
  const sessionAt = block.indexOf("session-dom");
  const fetchAt = block.indexOf('origin: "direct-fetch"');
  assert.ok(sessionAt >= 0 && fetchAt > sessionAt, "session DOM must precede the session-less fetch");
  assert.match(block, /if \(!lotteServerAnalyzed\)/);
});

test("lotte server evidence records which document it came from", () => {
  assert.match(inline, /서버 검색 출처/);
  assert.match(inline, /origin === "session-dom" \? "세션 화면"/);
  assert.match(inline, /origin === "direct-fetch" \? "직접 조회"/);
});
