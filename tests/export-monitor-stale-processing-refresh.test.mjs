import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

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

test("stale monitor recovery accepts Electron reloadIgnoringCache returning void", async () => {
  const start = main.indexOf("async function rebuildStaleSellerExportMonitor");
  const end = main.indexOf("async function watchAllSellerExportJobsEveryTenSeconds", start);
  const recovery = main.slice(start, end);
  let reloads = 0, recreations = 0;
  const context = {
    sellerMonitorWindow: {
      isDestroyed: () => false,
      webContents: { session: { clearCache: async () => {} } },
      removeAllListeners: () => {}, destroy: () => {},
    },
    sellerWindow: {
      isDestroyed: () => false,
      webContents: { getURL: () => "https://seller.poizon.com/main/exportCenter",
        reloadIgnoringCache: () => { reloads++; } },
    },
    brandExportJobPending: false,
    ensureSellerMonitorWindow: () => { recreations++; },
    mainWindow: { webContents: { send: () => {} } },
  };
  await runInNewContext(`${recovery}\nrebuildStaleSellerExportMonitor("123", { brandName: "Nike" })`, context);
  assert.equal(reloads, 1);
  assert.equal(recreations, 1);
  assert.equal(context.sellerMonitorWindow, null);
});
