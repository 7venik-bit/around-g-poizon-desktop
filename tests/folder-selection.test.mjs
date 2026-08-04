import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

test("brand export folder button is visible and invokes the persisted folder chooser", async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(join(root, "src/index.html"), "utf8"),
    readFile(join(root, "src/renderer.js"), "utf8"),
    readFile(join(root, "preload.cjs"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
  ]);

  assert.match(html, /id="brand-export-folder-select"[^>]*>폴더 지정<\/button>/);
  assert.match(renderer, /#brand-export-folder-select/);
  assert.match(renderer, /window\.aroundG\.selectBrandExportFolder\(\)/);
  assert.match(preload, /selectBrandExportFolder: \(\) => ipcRenderer\.invoke\("brand-export:select-folder"\)/);
  assert.match(main, /ipcMain\.handle\("brand-export:select-folder"/);
  assert.match(main, /await store\.setSettings\(\{ brandExportFolder: folder \}\)/);
  assert.match(main, /startBrandExportFolderPolling\(\)/);
});

test("selected and restored folder paths use one consistent label renderer", async () => {
  const renderer = await readFile(join(root, "src/renderer.js"), "utf8");

  assert.match(renderer, /function renderBrandExportFolder\(folder = ""\)/);
  assert.match(renderer, /브랜드별 저장 폴더:/);
  assert.doesNotMatch(renderer, /`저장 폴더: \$\{automation\.folder\}`/);
});
