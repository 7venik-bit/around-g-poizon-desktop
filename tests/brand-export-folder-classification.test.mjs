import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

test("POIZON downloads are saved in separate brand and job-number folders", async () => {
  const main = await readFile(join(root, "main.mjs"), "utf8");
  assert.match(main, /const brandFolder = join\(folder, brandExportFolderName\(exportBrand, downloadJobId\)\)/);
  assert.match(main, /item\.setSavePath\(filePath\)/);
  assert.match(main, /const detectedBrand = brandIntegrity\.dominantBrand/);
  assert.match(main, /const detectedFolder = join\(folder, brandExportFolderName\(detectedBrand, downloadJobId\)\)/);
  assert.match(main, /await rename\(filePath, detectedPath\)/);
});

test("brand export file discovery includes categorized subfolders and parses job numbers", async () => {
  const main = await readFile(join(root, "main.mjs"), "utf8");
  assert.match(main, /async function listBrandExportExcelEntries\(folder\)/);
  assert.match(main, /if \(entry\.isDirectory\(\)\) await visit\(path\)/);
  assert.match(main, /parseBrandExportFolderName\(basename\(entry\.directory\)\)/);
  assert.match(main, /folderMeta\.brandName \|\| brandFromExportFileName/);
  assert.match(main, /folderMeta\.jobId \|\| savedJob\?\.jobId/);
});
