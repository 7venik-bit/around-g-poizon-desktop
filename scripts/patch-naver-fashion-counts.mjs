import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../relay/domestic-search.mjs", import.meta.url);
const before = "const domesticDisplayCount = Math.min(scopedPositiveCount, domesticVisibleProducts.size);";
const after = "const domesticDisplayCount = scopedPositiveCount;";

const source = await readFile(targetPath, "utf8");

if (source.includes(after)) {
  console.log("Naver Fashion Town authoritative channel counts already enabled.");
  process.exit(0);
}

const matches = source.split(before).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one Naver Fashion Town count clamp, found ${matches}.`);
}

const patched = source.replace(before, after);
await writeFile(targetPath, patched, "utf8");
console.log("Patched Naver Fashion Town counts: official brand store / department store / outlet now preserve the displayed tab totals exactly.");
