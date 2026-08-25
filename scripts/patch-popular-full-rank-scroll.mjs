import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
if (!main.includes("POIZON 인기상품 표는 가상 스크롤")) {
  const captureStart = main.indexOf("const SELLER_CAPTURE_SCRIPT = `(async () => {");
  if (captureStart < 0) throw new Error("popular full-scroll patch target missing: SELLER_CAPTURE_SCRIPT");
  const blockStart = main.indexOf("  const collected = new Map();", captureStart);
  const blockEndMarker = "  const nodes = [...collected.values()].slice(0, 5000);";
  const blockEndIndex = main.indexOf(blockEndMarker, blockStart);
  if (blockStart < 0 || blockEndIndex < 0) {
    throw new Error("popular full-scroll patch target missing: capture accumulation block");
  }
  const blockEnd = blockEndIndex + blockEndMarker.length;
  const after = `  const collected = new Map();\n  const collectVisibleRows = () => {\n    const rows = [...scope.querySelectorAll("tbody tr, tr, [role='row'], [data-row-key], li, [class*='row'], [class*='item']")];\n    for (const element of rows) {\n      const rect = element.getBoundingClientRect();\n      if (rect.width <= 0 || rect.height <= 0) continue;\n      const text = String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();\n      if (!text || text.length > 3000) continue;\n      const image = element.querySelector?.("img[src]");\n      const imageUrl = image?.src || "";\n      const key = [\n        element.getAttribute?.("data-row-key"),\n        element.getAttribute?.("data-key"),\n        element.getAttribute?.("data-id"),\n        text,\n        imageUrl,\n      ].filter(Boolean).join("\\n");\n      collected.set(key, { text, imageUrl });\n    }\n  };\n\n  // POIZON 인기상품 표는 가상 스크롤이라 화면에 보이는 행만 DOM에 존재한다.\n  // 1위부터 끝까지 실제 스크롤을 이동하며 각 화면의 행을 누적 수집한다.\n  const scrollCandidates = [scope, ...scope.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]\n    .filter((element, index, all) => all.indexOf(element) === index)\n    .map((element) => {\n      const rect = element.getBoundingClientRect();\n      const style = getComputedStyle(element);\n      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);\n      const scrollable = /auto|scroll|overlay/i.test(style.overflowY) || maximum > 120;\n      const tableHint = /SPU\\s*기준|SKU\\s*기준|상품정보|평균\\s*거래가/.test(String(element.innerText || ""));\n      return { element, maximum, scrollable, tableHint, area: rect.width * rect.height };\n    })\n    .filter((candidate) => candidate.scrollable && candidate.maximum > 80)\n    .sort((left, right) => (right.tableHint - left.tableHint) || (right.maximum - left.maximum) || (right.area - left.area));\n  const scrollTarget = scrollCandidates[0]?.element || null;\n  if (scrollTarget) {\n    scrollTarget.scrollTop = 0;\n    scrollTarget.dispatchEvent(new Event("scroll", { bubbles: true }));\n    await new Promise((resolve) => setTimeout(resolve, 180));\n    let previousCount = -1;\n    let stableReads = 0;\n    for (let attempt = 0; attempt < 80; attempt += 1) {\n      collectVisibleRows();\n      const maximum = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);\n      const atEnd = scrollTarget.scrollTop >= maximum - 3;\n      if (collected.size === previousCount) stableReads += 1;\n      else stableReads = 0;\n      previousCount = collected.size;\n      if (atEnd && stableReads >= 3) break;\n      const step = Math.max(260, Math.floor(scrollTarget.clientHeight * 0.72));\n      scrollTarget.scrollTop = Math.min(maximum, scrollTarget.scrollTop + step);\n      scrollTarget.dispatchEvent(new Event("scroll", { bubbles: true }));\n      await new Promise((resolve) => setTimeout(resolve, 120));\n    }\n  }\n  collectVisibleRows();\n  const nodes = [...collected.values()].slice(0, 5000);`;
  main = main.slice(0, blockStart) + after + main.slice(blockEnd);
}
await writeFile(mainPath, main, "utf8");
console.log("popular list virtual-scroll accumulation restored for full ranking capture");
