import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("seller export snapshot compiles a numeric job-number regex", () => {
  const match = main.match(/const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT = `([\s\S]*?)`;\r?\n\r?\nasync function readSellerExportJobsFromWindow/);
  assert.ok(match, "snapshot script template must exist");

  const runtimeScript = Function(`return \`${match[1].replace(/`/g, "\\`")}\`;`)();
  const firstPatternSource = runtimeScript.match(/firstCellText\.match\(\/(.+?)\//)?.[1];
  const rowPatternSource = runtimeScript.match(/\|\| text\.match\(\/(.+?)\//)?.[1];

  assert.equal(firstPatternSource, String.raw`\b\d{7,}\b`);
  assert.equal(rowPatternSource, String.raw`\b\d{7,}\b`);
  assert.equal(new RegExp(firstPatternSource).test("1004747578"), true);
  assert.equal(new RegExp(rowPatternSource).test("상품검색 내보내기 1004747578 처리 중"), true);
});

test("release metadata is 2.10.248", async () => {
  const [pkg, lock] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(pkg.version, "2.10.248");
  assert.equal(lock.version, "2.10.248");
  assert.equal(lock.packages[""].version, "2.10.248");
});
