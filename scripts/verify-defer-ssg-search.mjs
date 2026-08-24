import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");

assert.ok(main.includes("if (lotteChannelSource && securityRetry < 1)"),
  "Lotte may keep its immediate blocked-page retry");
assert.ok(!main.includes("if ((ssgChannelSource || lotteChannelSource) && securityRetry < 1)"),
  "SSG must not retry immediately on its automated-access block page");
assert.ok(main.includes("const deferredSsgRetries = []"),
  "blocked SSG searches must be queued for a later pass");
assert.ok(main.includes("deferredSsgRetries.push({ source, index: resolvedSourceIndex })"),
  "blocked SSG source must enter the deferred queue");
assert.ok(main.includes("source, articleNumber, brand, title, 1, queryAttempt, sharedNaverSession"),
  "deferred SSG retry must run only once as retry attempt 1");
assert.ok(main.includes('"ssg_access_limited_deferred"'),
  "second SSG block must remain an access-limited verification failure");
assert.ok(main.includes("deferredRetryAttempted: true"),
  "SSG source must report that the later retry was attempted");

const lotteIndex = relay.indexOf('{ store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true }');
const ssgIndex = relay.indexOf('{ store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true }');
assert.ok(lotteIndex >= 0 && ssgIndex >= 0, "Lotte and SSG integrated sources must exist");
assert.ok(lotteIndex < ssgIndex, "SSG must run after LotteON");
assert.equal((relay.match(/domesticChannel: "ssg-general"/g) || []).length, 1,
  "SSG must still use one integrated search");
assert.equal((relay.match(/domesticChannel: "lotte-general"/g) || []).length, 1,
  "LotteON must still use one integrated search");

console.log("SSG deferred-search regression checks passed");
