import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`excel bulk import patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`excel bulk import patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

const oldSaveLoop = `    const valueAt = (row, column) => column >= 0 ? row?.[column] ?? "" : "";
    let imported = 0;
    for (const values of sheet.slice(headerRowIndex + 1)) {
      const row = Array.isArray(values) ? values : [];
      const articleNumber = String(valueAt(row, columns.articleNumber) || "").trim();
      const name = String(valueAt(row, columns.name) || "").trim();
      if (!articleNumber && !name) continue;
      await store.upsert("products", {
        articleNumber,
        name,
        brand: String(valueAt(row, columns.brand) || "").trim(),
        spuId: String(valueAt(row, columns.spuId) || "").trim(),
        poizonPrice: Number(String(valueAt(row, columns.poizonPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        domesticPrice: Number(String(valueAt(row, columns.domesticPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        imageUrl: String(valueAt(row, columns.imageUrl) || "").trim(),
        source: "excel"
      });
      imported += 1;
    }

    const identityColumnFound = columns.articleNumber >= 0 || columns.name >= 0;`;

const newSaveLoop = `    const valueAt = (row, column) => column >= 0 ? row?.[column] ?? "" : "";
    const importItemsByIdentity = new Map();
    for (const values of sheet.slice(headerRowIndex + 1)) {
      const row = Array.isArray(values) ? values : [];
      const articleNumber = String(valueAt(row, columns.articleNumber) || "").trim();
      const name = String(valueAt(row, columns.name) || "").trim();
      if (!articleNumber && !name) continue;
      const brand = String(valueAt(row, columns.brand) || "").trim();
      const spuId = String(valueAt(row, columns.spuId) || "").trim();
      const identity = articleNumber
        ? \`article:\${articleNumber.normalize("NFKC").toUpperCase()}\`
        : spuId
          ? \`spu:\${spuId.normalize("NFKC").toUpperCase()}\`
          : \`name:\${brand.normalize("NFKC").toUpperCase()}|\${name.normalize("NFKC").toUpperCase()}\`;
      const item = {
        articleNumber,
        name,
        brand,
        spuId,
        poizonPrice: Number(String(valueAt(row, columns.poizonPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        domesticPrice: Number(String(valueAt(row, columns.domesticPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        imageUrl: String(valueAt(row, columns.imageUrl) || "").trim(),
        source: "excel"
      };
      // When an export contains several rows for the same product/size family,
      // keep one local product record instead of repeatedly rewriting the JSON store.
      if (!articleNumber) item.id = \`excel:\${identity}\`;
      importItemsByIdentity.set(identity, item);
    }

    const importItems = [...importItemsByIdentity.values()];
    // JsonStore.bulkUpsert accepts at most 500 items and saves once per batch.
    // The previous row-by-row upsert rewrote the entire JSON file hundreds or
    // thousands of times, making a normal POIZON workbook appear frozen.
    for (let start = 0; start < importItems.length; start += 500) {
      await store.bulkUpsert("products", importItems.slice(start, start + 500));
    }
    const imported = importItems.length;

    const identityColumnFound = columns.articleNumber >= 0 || columns.name >= 0;`;

main = replaceOnce(main, oldSaveLoop, newSaveLoop, "replace row-by-row store writes with 500-row bulk writes");
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
const oldStart = `$("#import-button").addEventListener("click", async () => {
  const button = $("#import-button");
  if (button) button.disabled = true;
  try {`;
const newStart = `$("#import-button").addEventListener("click", async () => {
  const button = $("#import-button");
  const previousLabel = button?.textContent || "Excel 가져오기";
  if (button) {
    button.disabled = true;
    button.textContent = "Excel 불러오는 중…";
  }
  try {`;
renderer = replaceOnce(renderer, oldStart, newStart, "show Excel import progress state");
renderer = replaceOnce(
  renderer,
  `  } finally {
    if (button) button.disabled = false;
  }
});`,
  `  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }
});`,
  "restore Excel import button after completion",
);
await writeFile(rendererPath, renderer, "utf8");

console.log("Excel import now deduplicates rows and saves in 500-item batches instead of rewriting the store per row");
