import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("download monitor opens a cache-busted export-center URL", () => {
  assert.match(main, /function sellerExportMonitorUrl\(\)[\s\S]*?searchParams\.set\("aroundGMonitor", String\(Date\.now\(\)\)\)/);
  assert.match(main, /sellerMonitorWindow\.loadURL\(sellerExportMonitorUrl\(\)\)/);
});

test("stale processing recovery clears response cache without clearing login data", () => {
  const start = main.indexOf("async function rebuildStaleSellerExportMonitor");
  const end = main.indexOf("async function watchAllSellerExportJobsEveryTenSeconds", start);
  const recovery = main.slice(start, end);

  assert.match(recovery, /await monitorSession\?\.clearCache\(\)\.catch/);
  assert.match(recovery, /ensureSellerMonitorWindow\(\)/);
  assert.doesNotMatch(recovery, /clearStorageData|clearAuthCache|clearHostResolverCache/);
});
