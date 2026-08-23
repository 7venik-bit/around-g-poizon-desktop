import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("all stores receive code, title, then title plus code in that order", () => {
  assert.match(relay, /const orderedProductQueries = \[\s*exactProductCode,\s*exactProductTitle,\s*\[exactProductTitle, exactProductCode\]/s);
  assert.match(relay, /searchAttempts: queryCandidates\.map/);
  assert.match(relay, /query: candidate,\s*url: searchUrlFor\(candidate\)/s);
  assert.match(relay, /searchAttempts: Array\.isArray\(searchAttempts\) \? searchAttempts : \[\]/);
});

test("a source submits the next query only when the prior query has no result", () => {
  assert.match(main, /for \(const queryAttempt of queryAttempts\)/);
  assert.match(main, /source, articleNumber, brand, title, 0, queryAttempt, sharedNaverSession/);
  assert.match(main, /queryResult\.verificationReason \|\| queryResult\.detailVerificationPending/);
  assert.match(main, /queryResult\.absenceConfirmed !== true/);
  assert.doesNotMatch(main, /technicalAttempts/);
  assert.doesNotMatch(main, /attempt > 0\) await wait\(1_500\)/);
});
