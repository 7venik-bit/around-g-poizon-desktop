import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("clearing brand work removes browser and persisted job history without deleting Excel", async () => {
  const [main, renderer] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  ]);
  assert.match(main, /setSettings\(\{ brandExportJobCache: \[\] \}\)/);
  assert.match(renderer, /"around-g-last-brand-export-job"/);
  assert.doesNotMatch(main.match(/ipcMain\.handle\("brand-export:clear-session"[\s\S]*?\n  \}\);/)?.[0] || "", /unlink|rm\(|removeFile/);
});
