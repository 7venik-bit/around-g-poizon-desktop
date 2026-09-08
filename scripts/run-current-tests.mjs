import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(readFileSync(new URL("../tests/superseded-test-files.json", import.meta.url), "utf8"));
const excluded = new Set(manifest.files || []);
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs") && !excluded.has(name))
  .sort()
  .map((name) => `tests/${name}`);

if (!files.length) throw new Error("No current-contract tests were selected");
// Several legacy-compatible integration tests intentionally exercise patch
// idempotency against the working tree. Run files serially so one test cannot
// observe another test's temporary source state.
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
