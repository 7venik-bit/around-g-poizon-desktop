import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("program links open in a new Chrome tab on Windows", () => {
  assert.match(mainSource, /async function openExternalInChromeTab/);
  assert.match(mainSource, /Google\\Chrome\\Application\\chrome\.exe/);
  assert.match(mainSource, /'--new-tab'/);
  assert.match(mainSource, /ipcMain\.handle\("external:open"[\s\S]*?return openExternalInChromeTab\(url\)/);
});

test("official verification opens both pages through Chrome tabs", () => {
  assert.match(mainSource, /await openExternalInChromeTab\(discovery\.href\)/);
  assert.match(mainSource, /await openExternalInChromeTab\(product\.href\)/);
});
