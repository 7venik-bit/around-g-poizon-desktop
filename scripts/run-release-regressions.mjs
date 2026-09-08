import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const files = [...new Set([...process.argv.slice(2), "tests/poizon-review-workspace.test.mjs", "tests/poizon-sku-safe-pagination.test.mjs", "tests/poizon-fake-missing.test.mjs", "tests/poizon-value-integrity.test.mjs", "tests/poizon-screen-excel-sync.test.mjs", "tests/live-poizon-crosscheck.test.mjs", "tests/poizon-value-safety.test.mjs"])];
if (!files.length) throw new Error("At least one regression test file is required");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const output = String(result.stdout || "") + String(result.stderr || "");
process.stdout.write(output);
if (result.error) console.error(result.error);
const failures = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1]);
const firstError = output.match(/^\s*error:\s*([^\n]*)\n([\s\S]{0,1000})/m);
const compact = (value, length) => String(value).replace(/\s+/g, " ").slice(0, length);
const failed = result.status !== 0 || Boolean(result.error || result.signal);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `failures=${compact(failures.join(" | ") || (failed ? "Test process failed" : "All regression tests passed"), 230)}\n`
    + `detail=${compact(firstError ? firstError[1] + " " + firstError[2] : result.error?.message || (failed ? "Inspect test process log" : "No failures"), 350)}\n`);
}
process.exitCode = failed ? 1 : 0;
