import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

function sellerSnapshotRuntimeSource() {
  const match = main.match(/const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT = `([\s\S]*?)`;\r?\n\r?\nasync function readSellerExportJobsFromWindow/);
  assert.ok(match, "snapshot script template must exist");
  return Function(`return \`${match[1].replace(/`/g, "\\`")}\`;`)();
}

test("Download Center snapshot supports virtual rows and shadow DOM", () => {
  assert.match(main, /const roots = \[document\]/);
  assert.match(main, /element\.shadowRoot/);
  assert.match(main, /data-row-id/);
  assert.match(main, /createTreeWalker/);
});

test("Download Center timestamps tolerate localized separators and spacing", () => {
  assert.match(main, /\(\?:\[-\/.\]\|년\)/);
  assert.match(main, /\(\?:\[-\/.\]\|월\)/);
  assert.match(main, /allowMissingTimestamp: !baselineAvailable && elapsedMs >= 20_000/);

  const runtime = sellerSnapshotRuntimeSource();
  const source = runtime.match(/const datePattern = \/(.+?)\/g/)?.[1];
  assert.ok(source, "runtime date regex must exist");
  const datePattern = new RegExp(source);
  assert.equal(datePattern.test("2026-09-01 17:05:31"), true);
  assert.equal(datePattern.test("2026. 9. 1. 17:05"), true);
  assert.equal(datePattern.test("2026년 9월 1일 17:05"), true);
});
