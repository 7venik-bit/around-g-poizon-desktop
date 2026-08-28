import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

test("official mall physically types the query before submitting", () => {
  const start = main.indexOf("async function submitOfficialMallSearch");
  const end = main.indexOf("async function officialMallSearchWasExecuted", start);
  assert.ok(start >= 0 && end > start);
  const submit = main.slice(start, end);
  assert.match(submit, /const inputTarget =/);
  assert.match(submit, /prepared\.inputTarget/);
  assert.match(submit, /keyCode: "A", modifiers: \["control"\]/);
  assert.match(submit, /await searchWindow\.webContents\.insertText\(exactQuery\)/);
  assert.match(submit, /await wait\(350\)/);
});
