import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const script = readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

function diagnostics(t, sources) {
  const dom = new JSDOM("<body><main></main></body>", { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  dom.window.document.querySelector("main").innerHTML =
    dom.window.renderDomestic({ products: [], sources });
  const block = dom.window.document.querySelector(".domestic-inline-diagnostics pre");
  assert.ok(block, "diagnostics block renders for a failed source");
  return block.textContent;
}

const failedNaverSource = {
  store: "네이버 패션타운",
  searchQuery: "(J) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙 JH9976",
  verificationReason: "naver_explicit_empty",
  verificationStage: "naver_result_capture",
  absenceConfirmed: true,
  verificationDiagnostics: {
    stage: "naver_result_capture",
    resolvedUrl: "https://shopping.naver.com/window/search/fashion-group?q=JH9976",
    visibleResultCount: 0,
    productCardCount: 0,
    queryComparisons: [
      { query: "JH9976", collected: 0, matched: 0, rejected: 0, reason: "naver_explicit_empty" },
      { query: "(J) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙 JH9976", collected: 0, matched: 0, rejected: 0, reason: "naver_explicit_empty" },
    ],
    channelFallback: "outlet",
    fallbackChannels: [
      { channel: "outlet", settled: true, explicitEmpty: true, cards: 0 },
      { channel: "brand-store", settled: false },
      { channel: "department", settled: false },
    ],
    fallbackUrl: "https://shopping.naver.com/window/department/search?q=JH9976&queryType=ac",
  },
};

test("naver diagnostics show per-attempt collection and channel fallback", (t) => {
  const text = diagnostics(t, [failedNaverSource]);
  assert.match(text, /시도별 결과/);
  assert.match(text, /JH9976: 수집 0·일치 0·탈락 0·naver_explicit_empty/);
  assert.match(text, /채널 폴백/);
  assert.match(text, /채널별 확정/);
  assert.match(text, /outlet: 확정·카드 0·없음표시 true/);
  assert.match(text, /brand-store: 미확정/);
  assert.match(text, /폴백 주소/);
  assert.match(text, /window\/department\/search/);
});
