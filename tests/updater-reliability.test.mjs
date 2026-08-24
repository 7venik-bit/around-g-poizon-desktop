import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);

async function source() {
  return readFile(mainPath, "utf8");
}

test("idle POIZON monitor does not block a downloaded app update", async () => {
  const text = await source();
  const match = text.match(/function hasActiveUpdateSensitiveWork\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "update-sensitive work predicate must exist");
  assert.doesNotMatch(match[1], /brandExportMonitorRunning/);
  assert.match(match[1], /brandExportJobPending/);
  assert.match(match[1], /brandDownloadStarted/);
});

test("packaged updater has an explicit GitHub release feed", async () => {
  const text = await source();
  assert.match(text, /autoUpdater\.setFeedURL\(\{/);
  assert.match(text, /owner:\s*"7venik-bit"/);
  assert.match(text, /repo:\s*"around-g-poizon-desktop"/);
  assert.match(text, /"Cache-Control":\s*"no-cache"/);
});
