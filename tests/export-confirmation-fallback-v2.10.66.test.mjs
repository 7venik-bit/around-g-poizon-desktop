import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("an unobserved export acknowledgement continues to job-number discovery", () => {
  const confirmationBlock = main.match(
    /let confirmationObserved = false;[\s\S]*?async function automateSellerBrandExport/
  )?.[0] || "";
  assert.match(confirmationBlock, /ok: true/);
  assert.match(confirmationBlock, /confirmationTimedOut: !requestAcknowledged/);
  assert.doesNotMatch(confirmationBlock, /EXPORT_REQUEST_NOT_CONFIRMED/);
  assert.doesNotMatch(confirmationBlock, /clickLikeUser\(exportButton\)[\s\S]*clickLikeUser\(exportButton\)/);
  assert.match(main, /const verificationTimeoutMs = 180000/);
  assert.match(main, /findNewSellerExportJob/);
});

test("release metadata is 2.10.67", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.67");
  assert.equal(JSON.parse(lockSource).version, "2.10.67");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.67");
});
