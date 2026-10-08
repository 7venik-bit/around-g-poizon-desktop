import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const loaderStart = main.indexOf("async function loadDomesticRetailerResultPage(");
assert.ok(loaderStart >= 0, "retailer result loader missing");
const loaderEnd = main.indexOf("async function loadMusinsaResultPage(", loaderStart);
const loader = main.slice(loaderStart, loaderEnd);

test("a lone empty phrase never ends the retailer result load", () => {
  // SPA sections render at different times; a single transient match keeps
  // polling for real cards instead of declaring an empty result.
  assert.match(loader, /let emptyStreak = 0;/);
  assert.match(loader, /emptyStreak = settledEmpty \? emptyStreak \+ 1 : 0;/);
  assert.match(loader, /emptyStreak >= 3/);
  assert.match(loader, /String\(state\?\.documentReadyState \|\| ""\) === "complete"/);
  assert.match(loader, /Number\(state\?\.cards \|\| 0\) === 0/);
});

test("cards still finish the retailer result load immediately", () => {
  assert.match(loader, /state\.ready = Boolean\(state\.ready\) && \(Number\(state\.cards \|\| 0\) > 0 \|\| emptyStreak >= 3\)/);
  assert.match(main, /return \{ok: true, resolvedUrl: state\.href, explicitEmpty: state\.explicitEmpty\}/);
});

test("a settled empty retailer grid names its path instead of silence", () => {
  const earlyStart = main.indexOf("// An empty-result message on the exact submitted SSG/LotteON URL");
  assert.ok(earlyStart >= 0, "explicit-empty early return missing");
  const early = main.slice(earlyStart, earlyStart + 1200);
  assert.match(early, /absenceConfirmed: true/);
  assert.match(early, /verificationReason: "retailer_explicit_empty"/);
  assert.match(early, /verificationStage: "retailer_result_navigation"/);
  assert.match(early, /explicitEmptyText: true/);
  assert.match(early, /productCardCount: 0/);
});
