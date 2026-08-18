import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [inventory, renderer, main] = await Promise.all([
  readFile(new URL("../src/inventory.js", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
]);

test("inventory clear invalidates a delayed Excel import", () => {
  assert.match(inventory, /const generation = \+\+workGeneration;/);
  assert.match(inventory, /if \(generation !== workGeneration\) return;/);
  assert.match(inventory, /onBrandWorkHistoryCleared.*clearWorkScreen/);
});


test("clear broadcasts to inventory windows without closing them", () => {
  const start = main.indexOf('ipcMain.handle("brand-export:clear-session"');
  const end = main.indexOf('ipcMain.handle("brand-export:select-folder"', start);
  const handler = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /brandWorkSessionGeneration \+= 1;/);
  assert.match(handler, /brandExportJobs\.clear\(\)/);
  assert.match(handler, /setSettings\(\{ brandExportJobCache: \[\] \}\)/);
  assert.match(handler, /inventoryWindow\.webContents\.send\("brand-export:session-cleared"\)/);
  assert.doesNotMatch(handler, /inventoryWindow\.close\(\)/);
  assert.doesNotMatch(handler, /unlink|rm\(|removeFile/);
});

test("application startup preserves hidden interrupted-job recovery evidence", () => {
  const start = main.indexOf("app.whenReady().then(async () => {");
  const end = main.indexOf('ipcMain.handle("store:snapshot"', start);
  const startup = main.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(startup, /restorePortableOneDriveBackupIfFresh/);
  assert.doesNotMatch(startup, /setSettings\(\{ brandExportJobCache: \[\] \}\)/);
  assert.doesNotMatch(startup, /brandExportFileValidationCache: \[\]/);
});
