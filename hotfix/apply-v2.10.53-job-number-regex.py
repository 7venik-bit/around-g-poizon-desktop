from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
main_path = ROOT / "main.mjs"
main = main_path.read_text(encoding="utf-8")

start = main.find("const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT")
end = main.find("async function readSellerExportJobsFromWindow", start)
if start < 0 or end < 0:
    raise SystemExit("seller export snapshot script block not found")

block = main[start:end]
replacements = {
    r"firstCellText.match(/\b\d{7,}\b/)": r"firstCellText.match(/\\b\\d{7,}\\b/)",
    r"text.match(/\b\d{7,}\b/)": r"text.match(/\\b\\d{7,}\\b/)",
}
for old, new in replacements.items():
    if old not in block:
        raise SystemExit(f"expected regex source not found: {old}")
    block = block.replace(old, new, 1)
main = main[:start] + block + main[end:]
main_path.write_text(main, encoding="utf-8")

for relative in ["package.json", "package-lock.json"]:
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "2.10.53"
    if relative == "package-lock.json":
        data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.53"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for path in (ROOT / "tests").glob("*.test.mjs"):
    source = path.read_text(encoding="utf-8")
    if "2.10.52" in source:
        path.write_text(source.replace("2.10.52", "2.10.53"), encoding="utf-8")

regression = ROOT / "tests" / "export-job-number-regex-v2.10.53.test.mjs"
regression.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("seller export snapshot compiles a numeric job-number regex", () => {
  const match = main.match(/const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT = `([\s\S]*?)`;\n\nasync function readSellerExportJobsFromWindow/);
  assert.ok(match, "snapshot script template must exist");

  const runtimeScript = Function(`return \`${match[1].replace(/`/g, "\\`")}\`;`)();
  const firstPatternSource = runtimeScript.match(/firstCellText\.match\(\/(.+?)\//)?.[1];
  const rowPatternSource = runtimeScript.match(/\|\| text\.match\(\/(.+?)\//)?.[1];

  assert.equal(firstPatternSource, String.raw`\b\d{7,}\b`);
  assert.equal(rowPatternSource, String.raw`\b\d{7,}\b`);
  assert.equal(new RegExp(firstPatternSource).test("1004747578"), true);
  assert.equal(new RegExp(rowPatternSource).test("상품검색 내보내기 1004747578 처리 중"), true);
});

test("release metadata is 2.10.53", async () => {
  const [pkg, lock] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(pkg.version, "2.10.53");
  assert.equal(lock.version, "2.10.53");
  assert.equal(lock.packages[""].version, "2.10.53");
});
''', encoding="utf-8")
