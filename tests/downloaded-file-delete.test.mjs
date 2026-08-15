import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const main = await readFile(join(root, "main.mjs"), "utf8");
const preload = await readFile(join(root, "preload.cjs"), "utf8");
const renderer = await readFile(join(root, "src", "renderer.js"), "utf8");
const html = await readFile(join(root, "src", "index.html"), "utf8");

test("downloaded Excel rows can be selected and deleted in a batch", () => {
  assert.match(html, /id="brand-download-select-all"/);
  assert.match(html, /id="brand-download-delete"/);
  assert.match(renderer, /data-select-brand-file-index/);
  assert.match(renderer, /선택한 Excel 파일 \$\{selected\.length\}개를 휴지통으로 이동할까요/);
});

test("selected files are moved to trash only from the configured Excel folder", () => {
  assert.match(preload, /trashBrandExportFiles/);
  assert.match(main, /ipcMain\.handle\("brand-export:trash-files"/);
  assert.match(main, /relative\(root, target\)/);
  assert.match(main, /await shell\.trashItem\(target\)/);
  assert.match(main, /\/\\\.xlsx\$\/i\.test\(target\)/);
});
