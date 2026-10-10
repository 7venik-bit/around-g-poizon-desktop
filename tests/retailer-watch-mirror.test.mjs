import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { watchTabKeyForStore } from "../services/external-chrome-login.mjs";

test("every domestic source maps to a watch tab", () => {
  assert.equal(watchTabKeyForStore("SSG"), "ssg");
  assert.equal(watchTabKeyForStore("SSG 백화점"), "ssg");
  assert.equal(watchTabKeyForStore("롯데온"), "lotte");
  assert.equal(watchTabKeyForStore("롯데온 백화점"), "lotte");
  assert.equal(watchTabKeyForStore("무신사"), "musinsa");
  assert.equal(watchTabKeyForStore("네이버 패션타운"), "naver");
  assert.equal(watchTabKeyForStore("코오롱몰"), "kolon");
  assert.equal(watchTabKeyForStore("브랜드 공식몰"), "official");
  assert.equal(watchTabKeyForStore("병행수입·편집샵"), "parallel");
  assert.equal(watchTabKeyForStore(""), "");
  assert.equal(watchTabKeyForStore("알 수 없는 판매처"), "");
});

test("watch mirror is wired without blocking collection", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /watchTabKeyForStore,/);
  assert.match(main, /pickRemoteDebuggingPort,/);
  assert.match(main, /isChromeResponsive,/);
  assert.match(main, /async function ensureWatchChrome\(\)/);
  assert.match(main, /async function navigateWatchTab\(tabKey = "", searchUrl = "", canceled/);
  assert.match(main, /function queueRetailerWatch\(source = \{\}, searchUrl = "", canceled/);
  assert.match(main, /queueRetailerMirror\(`watch:\$\{tabKey\}`/);
  assert.match(main, /closeLoginChrome\(watchChromeHandle\?\.child\)/);
  // Queued fire-and-forget next to the SSG/Lotte mirror, guarded for fixtures.
  assert.match(main, /\} else if \(typeof queueRetailerWatch === "function"\) \{/);
  assert.match(main, /queueRetailerWatch\(source, queryAttempt\.url, \(\) => domesticSearchCanceled\(generation\)\)/);
  // Watch navigation never requires login and never touches verdicts.
  assert.doesNotMatch(main, /confirmedExternalLogins\.has\(sourceId\)[\s\S]{0,400}navigateWatchTab/);
});
