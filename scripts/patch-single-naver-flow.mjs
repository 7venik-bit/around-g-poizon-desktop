import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(targetPath, "utf8");
const original = source;

const marker = "async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = \"\") {";
if (!source.includes(marker)) {
  throw new Error("clickRenderedProductCard function not found");
}

// Keep this patch deliberately idempotent and tolerant of nearby source changes.
// A release must never fail merely because main.mjs has already incorporated
// one of these protections in a slightly different form.
if (!source.includes("const naverProductClickAttempts = new Set();")) {
  source = source.replace(marker, `const naverProductClickAttempts = new Set();\n\n${marker}`);
}

if (!source.includes("stableProductIdentity")) {
  const expectedLine = `  const expectedUrl = String(productUrl || \"\").split(\"#\")[0];`;
  if (source.includes(expectedLine)) {
    source = source.replace(expectedLine, `${expectedLine}\n  const stableProductIdentity = (value) => {\n    try {\n      const parsed = new URL(String(value || \"\"));\n      for (const key of [\"productId\", \"nvMid\", \"itemId\", \"goodsNo\"]) {\n        const found = parsed.searchParams.get(key);\n        if (found) return key + \":\" + found;\n      }\n      const segments = parsed.pathname.split(\"/\").filter(Boolean);\n      return parsed.origin + \":\" + (segments.at(-1) || \"\");\n    } catch {\n      return String(value || \"\").split(\"#\")[0];\n    }\n  };\n  const clickAttemptKey = stableProductIdentity(expectedUrl);`);
  } else {
    console.log("Naver click identity anchor already changed; skipping identity injection.");
  }
}

// Remove the old result-page reload loop when that exact block is still present.
const reloadBlock = `  const resultsUrl = String(searchResultsUrl || \"\");\n  const currentUrl = String(searchWindow.webContents.getURL() || \"\");\n  if (resultsUrl && currentUrl !== resultsUrl) {\n    await Promise.race([\n      searchWindow.loadURL(resultsUrl),\n      new Promise((_, reject) => setTimeout(() => reject(new Error(\"SEARCH_RESULTS_RELOAD_TIMEOUT\")), 15_000)),\n    ]).catch(() => {});\n    await wait(1_200);\n  }`;
if (source.includes(reloadBlock)) {
  source = source.replace(reloadBlock, `  const resultsUrl = String(searchResultsUrl || \"\");\n  const currentUrl = String(searchWindow.webContents.getURL() || \"\");\n  // Keep the current live Naver result page. Reloading here changes SPA hrefs\n  // and can send the same product back into the search loop.\n  if (resultsUrl && currentUrl !== resultsUrl && /naver\\.com/i.test(currentUrl)) {\n    return false;\n  }`);
}

// Prefer the visible product image center when the legacy link-rect target exists.
const oldTarget = `    const rect = link.getBoundingClientRect();\n    if (rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`;
if (source.includes(oldTarget)) {
  source = source.replace(oldTarget, `    const card = link.closest(\"li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]\") || link.parentElement || link;\n    const image = link.querySelector(\"img,picture img\") || card?.querySelector?.(\"img,picture img\");\n    const linkRect = link.getBoundingClientRect();\n    const imageRect = image?.getBoundingClientRect?.();\n    const cardRect = card?.getBoundingClientRect?.();\n    const rect = imageRect && imageRect.width >= 60 && imageRect.height >= 60\n      ? imageRect\n      : linkRect.width > 0 && linkRect.height > 0 ? linkRect : cardRect;\n    if (!rect || rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`);
}

// Add the one-attempt guard only when both required symbols are available.
if (source.includes("const clickAttemptKey = stableProductIdentity(expectedUrl);")
    && !source.includes("naverProductClickAttempts.has(clickAttemptKey)")) {
  source = source.replace(
    "  const clickAttemptKey = stableProductIdentity(expectedUrl);",
    "  const clickAttemptKey = stableProductIdentity(expectedUrl);\n  if (naverProductClickAttempts.has(clickAttemptKey)) return false;",
  );
}

if (source.includes("const clickAttemptKey = stableProductIdentity(expectedUrl);")
    && !source.includes("naverProductClickAttempts.add(clickAttemptKey)")) {
  const boundsLine = "  const bounds = searchWindow.getContentBounds();";
  if (source.includes(boundsLine)) {
    source = source.replace(boundsLine, `  naverProductClickAttempts.add(clickAttemptKey);\n${boundsLine}`);
  }
}

if (source !== original) {
  await writeFile(targetPath, source, "utf8");
  console.log("Applied compatible Naver single-flow safeguards.");
} else {
  console.log("Naver single-flow safeguards already present or current main.mjs uses an equivalent structure.");
}
