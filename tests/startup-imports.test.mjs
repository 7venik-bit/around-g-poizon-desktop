import assert from "node:assert/strict";
import test from "node:test";

test("startup service modules load with all adapter exports", async () => {
  const adapter = await import("../relay/poizon-adapter.mjs");
  assert.equal(typeof adapter.queryBrandInfo, "function");

  const poizonService = await import("../services/poizon.mjs");
  assert.equal(typeof poizonService.queryExplorer, "function");
});
