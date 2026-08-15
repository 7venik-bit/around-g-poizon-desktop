import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const main = await readFile(join(root, "main.mjs"), "utf8");

test("POIZON Excel files prefer a dedicated OneDrive backup tree", () => {
  assert.match(main, /process\.env\.OneDriveConsumer, process\.env\.OneDrive, process\.env\.OneDriveCommercial/);
  assert.match(main, /join\(root, "Around G POIZON", "POIZON 다운로드 백업"\)/);
  assert.match(main, /join\(root, "브랜드 원본"\)/);
  assert.match(main, /join\(root, "인기상품 원본"\)/);
});

test("startup copies existing desktop Excel files and loads brand files from OneDrive", () => {
  assert.match(main, /async function initializeOneDrivePoizonBackup\(\)/);
  assert.match(main, /await copyExcelTree\(previousBrandFolder, brandFolder\)/);
  assert.ok(main.includes("POIZON-인기상품-원본-"));
  assert.match(main, /brandExportFolder: brandFolder/);
  assert.match(main, /await initializeOneDrivePoizonBackup\(\)/);
});

test("new popular-product workbooks are saved directly to OneDrive", () => {
  assert.match(main, /const folder = oneDrivePopularExportFolder\(\)[\s\S]*?app\.getPath\("desktop"\)/);
});

test("OneDrive keeps only the current installer and a portable settings backup", () => {
  assert.match(main, /function oneDriveInstallFolder\(\)/);
  assert.match(main, /Around-G-POIZON-Setup-\$\{version\}\.exe/);
  assert.match(main, /removeOldOneDriveInstallers\(folder, fileName\)/);
  assert.match(main, /Around-G-POIZON-복구\.json/);
  assert.match(main, /delete settings\[key\]/);
});

test("a fresh PC restores portable data and warns when OneDrive is disconnected", () => {
  assert.match(main, /restorePortableOneDriveBackupIfFresh\(hadLocalData\)/);
  assert.match(main, /store\.restorePortableBackup\(backup\)/);
  assert.match(main, /OneDrive 로그인이 필요합니다\. 백업이 중지되었습니다\./);
  assert.match(main, /ipcMain\.handle\("backup:status"/);
});
