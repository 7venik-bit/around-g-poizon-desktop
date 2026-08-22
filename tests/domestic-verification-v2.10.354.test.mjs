import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");

test("Naver department and outlet click the result tab even when its count is appended", () => {
  assert.match(main, /new RegExp\('\^' \+ compact\(label\) \+ '\(\?:\[\\\\d,\]\+개\)\?\$'\)/);
  assert.match(main, /includes\(expectedPath\)/);
  assert.match(main, /state\.url\.includes\(expectedPath\) \|\| state\.selected/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseDown"/);
});

test("detail-verified Musinsa colour cards retain one exact model identity", () => {
  assert.match(main, /detectedArticleNumber: detailArticleVerified \? articleNumber/);
  assert.match(main, /product\.brandVerifiedFromCard === false/);
  assert.match(relay, /brandVerifiedFromCard: brandMatched/);
  assert.match(main, /`\$\{product\.store\}:code:\$\{exactCode\}`/);
});

test("verification still requires detail stock and size inspection", () => {
  assert.match(main, /openRenderedSizeOptions\(searchWindow\)/);
  assert.match(main, /detailArticleVerificationRequired && !detailArticleVerified/);
  assert.match(main, /\.\.\.stockEvidence/);
});
