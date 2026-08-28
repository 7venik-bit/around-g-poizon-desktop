import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const patch = fs.readFileSync(new URL("../scripts/patch-domestic-access-next-day.mjs", import.meta.url), "utf8");

test("next-day release patch accepts the cancelable domestic-search signature", () => {
  assert.match(patch, /cancelableFunctionMarker/);
  assert.match(patch, /generation = domesticSearchGeneration/);
  assert.match(patch, /main\.includes\(cancelableFunctionMarker\)/);
});
