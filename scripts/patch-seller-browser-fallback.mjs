import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function patchSellerBrowserFallback(source) {
  const start = source.indexOf("// Final compatibility fallback for layouts that reject physical events.");
  const end = source.indexOf("    if (!advanced) {", start + 1);
  if (start < 0 || end <= start) throw new Error("Seller browser fallback section not found");
  const before = source.slice(start, end);
  const after = before
    .replaceAll("attempt < sellerPageResponseAttempts", "attempt < ${sellerPageResponseAttempts}")
    .replaceAll(String.raw`/상품\s*번호\s*[:：]/`, String.raw`/상품\\s*번호\\s*[:：]/`)
    .replaceAll(String.raw`text.replace(/\s+/g`, String.raw`text.replace(/\\s+/g`);
  if (!after.includes("attempt < ${sellerPageResponseAttempts}")
      || !after.includes(String.raw`/상품\\s*번호\\s*[:：]/`)
      || !after.includes("rows.length >= Math.max(1, ${expectedNextRowCount})")) {
    throw new Error("Seller fallback patch prerequisites or full-row validation missing");
  }
  return source.slice(0, start) + after + source.slice(end);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL("../main.mjs", import.meta.url);
  const source = await readFile(path, "utf8");
  const patched = patchSellerBrowserFallback(source);
  if (patched !== source) await writeFile(path, patched, "utf8");
  console.log("Verified isolated-browser retry limits and Korean product-row expressions.");
}
