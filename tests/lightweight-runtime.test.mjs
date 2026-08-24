import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("lightweight runtime patch releases closed auxiliary windows", async () => {
  const patch = await readFile(new URL("../scripts/patch-lightweight-runtime.mjs", import.meta.url), "utf8");
  assert.match(patch, /inventoryWindows\.delete\(window\)/);
  assert.match(patch, /officialInteractiveWindows\.delete\(window\)/);
  assert.match(patch, /domesticLoginWindows\.delete\(key\)/);
  assert.match(patch, /window\.once\("closed"/);
});
