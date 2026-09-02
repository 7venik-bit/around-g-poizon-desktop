import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const main = await readFile(join(root, "main.mjs"), "utf8");
const renderer = await readFile(join(root, "src", "renderer.js"), "utf8");
const html = await readFile(join(root, "src", "index.html"), "utf8");
const css = await readFile(join(root, "src", "style.css"), "utf8");

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
  assert.match(main, /brandExportFolder: configuredBrandFolder \|\| brandFolder/);
  assert.match(main, /await initializeOneDrivePoizonBackup\(\)/);
});

test("updates preserve the configured folder and recover Excel files from legacy roots", () => {
  assert.match(main, /brandExportFolder: configuredBrandFolder \|\| brandFolder/);
  assert.match(main, /function brandExportRecoveryFolders\(\)/);
  assert.match(main, /join\(oneDriveRoot, "바탕 화면", "Around G POIZON", "POIZON 전체내보내기"\)/);
  assert.match(main, /join\(oneDriveRoot, "Desktop", "Around G POIZON", "POIZON 전체내보내기"\)/);
  assert.match(main, /seenPaths\.has\(pathKey\)/);
  assert.match(main, /sameFolder\(entry\.directory, entry\.rootFolder\)/);
  assert.match(main, /for \(const job of savedBrandExportJobs\(\)\)/);
  assert.match(main, /candidates\.push\(dirname\(historicalFile\)\)/);
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

test("the three header lamps animate with the OneDrive connection state", () => {
  assert.match(html, /id="onedrive-lamps"/);
  assert.match(renderer, /lamps\.classList\.add\(payload\.state/);
  assert.match(css, /onedrive-lamp-chase/);
  assert.match(css, /window-dots\.connected i:nth-child\(3\)/);
  assert.match(css, /window-dots\.disconnected i:nth-child\(1\)/);
});
