import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(targetPath, "utf8");

const marker = "async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = \"\") {";
if (!source.includes(marker)) {
  throw new Error("clickRenderedProductCard function not found");
}

if (!source.includes("const naverProductClickAttempts = new Set();")) {
  source = source.replace(marker, `const naverProductClickAttempts = new Set();\n\n${marker}`);
}

const oldStart = `  const expectedUrl = String(productUrl || \"\").split(\"#\")[0];\n  if (!/^https?:\\/\\//i.test(expectedUrl)) return false;`;
const newStart = `  const expectedUrl = String(productUrl || \"\").split(\"#\")[0];\n  if (!/^https?:\\/\\//i.test(expectedUrl)) return false;\n  let clickAttemptKey = expectedUrl;\n  try {\n    const parsed = new URL(expectedUrl);\n    clickAttemptKey = parsed.origin + parsed.pathname;\n  } catch {}\n  if (naverProductClickAttempts.has(clickAttemptKey)) return false;`;
if (source.includes(oldStart)) source = source.replace(oldStart, newStart);
else if (!source.includes("naverProductClickAttempts.has(clickAttemptKey)")) {
  throw new Error("click attempt guard insertion point not found");
}

const oldTarget = `    const rect = link.getBoundingClientRect();\n    if (rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`;
const newTarget = `    const card = link.closest(\"li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]\") || link.parentElement || link;\n    const image = link.querySelector(\"img,picture img\") || card?.querySelector?.(\"img,picture img\");\n    const linkRect = link.getBoundingClientRect();\n    const imageRect = image?.getBoundingClientRect?.();\n    const cardRect = card?.getBoundingClientRect?.();\n    const rect = imageRect && imageRect.width >= 60 && imageRect.height >= 60\n      ? imageRect\n      : linkRect.width > 0 && linkRect.height > 0 ? linkRect : cardRect;\n    if (!rect || rect.width <= 0 || rect.height <= 0) return null;\n    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };`;
if (source.includes(oldTarget)) source = source.replace(oldTarget, newTarget);
else if (!source.includes("const image = link.querySelector(\"img,picture img\")")) {
  throw new Error("image-center click target insertion point not found");
}

const oldClick = `  const bounds = searchWindow.getContentBounds();\n  const clicked = await moveWindowsCursorAndClick(\n    bounds.x + target.x,\n    bounds.y + target.y,\n    650,\n  );\n  if (!clicked.ok) return false;\n  await wait(2_000);\n  const openedUrl = String(searchWindow.webContents.getURL() || \"\").split(\"#\")[0];\n  if (openedUrl === expectedUrl) return true;\n  try {\n    const opened = new URL(openedUrl);\n    const expected = new URL(expectedUrl);\n    return opened.origin === expected.origin && opened.pathname === expected.pathname;\n  } catch { return false; }`;
const newClick = `  naverProductClickAttempts.add(clickAttemptKey);\n  const bounds = searchWindow.getContentBounds();\n  const clicked = await moveWindowsCursorAndClick(\n    bounds.x + target.x,\n    bounds.y + target.y,\n    650,\n  );\n  if (!clicked.ok) return false;\n  await wait(2_000);\n  let openedUrl = String(searchWindow.webContents.getURL() || \"\").split(\"#\")[0];\n  const detailMatched = () => {\n    if (openedUrl === expectedUrl) return true;\n    try {\n      const opened = new URL(openedUrl);\n      const expected = new URL(expectedUrl);\n      return opened.origin === expected.origin && opened.pathname === expected.pathname;\n    } catch { return false; }\n  };\n  if (detailMatched()) return true;\n\n  // One fallback click only. Never restart the same Naver search after the card\n  // was already found and physically clicked once.\n  await searchWindow.webContents.executeJavaScript(\`(() => {\n    const expected = \${JSON.stringify(expectedUrl)};\n    const clean = (value) => String(value || \"\").split(\"#\")[0];\n    const links = [...document.querySelectorAll(\"a[href]\")];\n    const link = links.find((candidate) => clean(candidate.href) === expected)\n      || links.find((candidate) => {\n        try {\n          const left = new URL(clean(candidate.href));\n          const right = new URL(expected);\n          return left.origin === right.origin && left.pathname === right.pathname;\n        } catch { return false; }\n      });\n    if (!link) return false;\n    link.click();\n    return true;\n  })()\`, true).catch(() => false);\n  await wait(1_500);\n  openedUrl = String(searchWindow.webContents.getURL() || \"\").split(\"#\")[0];\n  return detailMatched();`;
if (source.includes(oldClick)) source = source.replace(oldClick, newClick);
else if (!source.includes("naverProductClickAttempts.add(clickAttemptKey)")) {
  throw new Error("single-attempt click block insertion point not found");
}

await writeFile(targetPath, source, "utf8");
console.log("Patched single Naver flow: one click attempt per product, image-center click, no repeated search after click attempt.");
