import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DOMESTIC_SEARCH_LINKS } from "../relay/domestic-search.mjs";

test("Musinsa exact-code URL keeps the all-goods scope", () => {
  assert.equal(
    DOMESTIC_SEARCH_LINKS["무신사"]("LU9CACS-0001"),
    "https://www.musinsa.com/search/goods?keyword=LU9CACS-0001&gf=A",
  );
});

test("Musinsa captures the exact first result before virtual-list scrolling", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /const musinsaSource = String\(source\.store \|\| ""\) === "무신사"/);
  assert.match(main, /naverPortalSource \|\| ssgChannelSource \|\| musinsaSource/);
});
