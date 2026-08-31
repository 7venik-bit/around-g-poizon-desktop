import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeDomesticProductCode } from "../relay/domestic-search.mjs";

test("official mall removes a trailing Chinese colour before typing", () => {
  assert.equal(sanitizeDomesticProductCode("207521-001黑色"), "207521-001");
  assert.equal(sanitizeDomesticProductCode("207521-001 黑色"), "207521-001");
});

test("official internal-search and physical input use only the sanitized query", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(
    main,
    /async function openOfficialMallInternalSearch[\s\S]*?const exactQuery = sanitizeDomesticProductCode\(query\) \|\| sanitizeDomesticQuery\(query\)/,
  );
  assert.match(
    main,
    /async function submitOfficialMallSearch[\s\S]*?const query = \$\{JSON\.stringify\(exactQuery\)\}/,
  );
  assert.match(
    main,
    /async function executeOfficialMallSearch[\s\S]*?submitOfficialMallSearch\(searchWindow, exactQuery\)[\s\S]*?officialMallSearchWasExecuted\(searchWindow, exactQuery, previousUrl\)/,
  );
});
