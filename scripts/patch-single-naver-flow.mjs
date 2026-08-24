import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(targetPath, "utf8");

const marker = "async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = \"\") {";
if (!source.includes(marker)) throw new Error("clickRenderedProductCard function not found");

if (!source.includes("const naverProductClickAttempts = new Set();")) {
  source = source.replace(marker, `const naverProductClickAttempts = new Set();\n\n${marker}`);
}

const oldStart = `  const expectedUrl = String(productUrl || \"\").split(\"#\")[0];\n  if (!/^https?:\\/\\//i.test(expectedUrl)) return false;`;
const newStart = `  const expectedUrl = String(productUrl || \"\").split(\"#\")[0];\n  if (!/^https?:\\/\\//i.test(expectedUrl)) return false;\n  const stableProductIdentity = (value) => {\n    try {\n      const parsed = new URL(String(value || \"\"));\n      for (const key of [\"productId\", \"nvMid\", \"itemId\", \"goodsNo\"]) {\n        const found = parsed.searchParams.get(key);\n        if (found) return key + \":\" + found;\n      }\n      const segments = parsed.pathname.split(\"/\").filter(Boolean);\n      const last = segments.at(-1) || \"\";\n      return parsed.origin + \":\" + last;\n    } catch { return String(value || \"\").split(\"#\")[0]; }\n  };\n  const clickAttemptKey = stableProductIdentity(expectedUrl);\n  if (naverProductClickAttempts.has(clickAttemptKey)) return false;`;
if (source.includes(oldStart)) source = source.replace(oldStart, newStart);
else if (!source.includes("stableProductIdentity")) throw new Error("click identity insertion point not found");

const reloadBlock = `  const resultsUrl = String(searchResultsUrl || \"\");\n  const currentUrl = String(searchWindow.webContents.getURL() || \"\");\n  if (resultsUrl && currentUrl !== resultsUrl) {\n    await Promise.race([\n      searchWindow.loadURL(resultsUrl),\n      new Promise((_, reject) => setTimeout(() => reject(new Error(\"SEARCH_RESULTS_RELOAD_TIMEOUT\")), 15_000)),\n    ]).catch(() => {});\n    await wait(1_200);\n  }`;
const noReloadBlock = `  const resultsUrl = String(searchResultsUrl || \"\");\n  const currentUrl = String(searchWindow.webContents.getURL() || \"\");\n  // One Naver query owns one live result page. Do not reload that page during\n  // card verification; SPA rerenders change tracking hrefs and caused loops.\n  if (resultsUrl && currentUrl !== resultsUrl && /naver\\.com/i.test(currentUrl)) {\n    return false;\n  }`;
if (source.includes(reloadBlock)) source = source.replace(reloadBlock, noReloadBlock);
else if (!source.includes("One Naver query owns one live result page")) throw new Error("result reload removal point not found");

const oldFinder = `    const links = [...document.querySelectorAll(\"a[href]\")];\n    const link = links.find((candidate) => clean(candidate.href) === expected)\n      || links.find((candidate) => {\n        try {\n          const left = new URL(clean(candidate.href));\n          const right = new URL(expected);\n          return left.origin === right.origin && left.pathname === right.pathname;\n        } catch { return false; }\n      });`;
const newFinder = `    const identity = (value) => {\n      try {\n        const parsed = new URL(clean(value));\n        for (const key of [\"productId\",\"nvMid\",\"itemId\",\"goodsNo\"]) {\n          const found = parsed.searchParams.get(key);\n          if (found) return key + \":\" + found;\n        }\n        const segments = parsed.pathname.split(\"/\").filter(Boolean);\n        return parsed.origin + \":\" + (segments.at(-1) || \"\");\n      } catch { return clean(value); }\n    };\n    const expectedIdentity = identity(expected);\n    const links = [...document.querySelectorAll(\"a[href]\")];\n    const link = links.find((candidate) => clean(candidate.href) === expected)\n      || links.find((candidate) => identity(candidate.href) === expectedIdentity)\n      || links.find((candidate) => {\n        try {\n          const left = new URL(clean(candidate.href));\n          const right = new URL(expected);\n          return left.origin === right.origin && left.pathname === right.pathname;\n        } catch { return false; }\n      });`;
const occurrences = source.split(oldFinder).length - 1;
if (occurrences > 0) source = source.split(oldFinder).join(newFinder);
else if (!source.includes("const expectedIdentity = identity(expected);")) throw new Error("stable card finder insertion point not found");

const oldTarget = `    const rect = link.getBoundingClientRect();\n    if (rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`;
const newTarget = `    const card = link.closest(\"li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]\") || link.parentElement || link;\n    const image = link.querySelector(\"img,picture img\") || card?.querySelector?.(\"img,picture img\");\n    const linkRect = link.getBoundingClientRect();\n    const imageRect = image?.getBoundingClientRect?.();\n    const cardRect = card?.getBoundingClientRect?.();\n    const rect = imageRect && imageRect.width >= 60 && imageRect.height >= 60\n      ? imageRect\n      : linkRect.width > 0 && linkRect.height > 0 ? linkRect : cardRect;\n    if (!rect || rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`;
if (source.includes(oldTarget)) source = source.replace(oldTarget, newTarget);

const oldClick = `  const bounds = searchWindow.getContentBounds();\n  const clicked = await moveWindowsCursorAndClick(\n    bounds.x + target.x,\n    bounds.y + target.y,\n    650,\n  );\n  if (!clicked.ok) return false;`;
const newClick = `  naverProductClickAttempts.add(clickAttemptKey);\n  const bounds = searchWindow.getContentBounds();\n  const clicked = await moveWindowsCursorAndClick(\n    bounds.x + target.x,\n    bounds.y + target.y,\n    650,\n  );\n  if (!clicked.ok) return false;`;
if (source.includes(oldClick)) source = source.replace(oldClick, newClick);
else if (!source.includes("naverProductClickAttempts.add(clickAttemptKey)")) throw new Error("single attempt guard point not found");

await writeFile(targetPath, source, "utf8");
console.log("Patched Naver single flow: stable product identity, no result reload loop, one physical click attempt per product.");
