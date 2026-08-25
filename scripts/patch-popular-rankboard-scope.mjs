import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let main = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`popular recovery patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`popular recovery patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const homeRoute = 'const SELLER_CENTER_URL = "https://seller.poizon.com/";';
const rankRoute = 'const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";';
if (main.includes(homeRoute)) main = main.replace(homeRoute, rankRoute);
if (!main.includes(rankRoute)) throw new Error("known-good popular list route restore failed");

// Keep the known-good merchantRankBoard route and table detector, but make
// completion rank-driven instead of scroll-driven. A virtualized row may be
// absent from the DOM for a few hundred milliseconds even though the table
// itself reached the bottom. Therefore 1-200 rank coverage is authoritative.
if (!main.includes('String(element.innerText || element.textContent || "").trim() === "인기상품"')) {
  throw new Error("known-good popular heading detector missing");
}
if (!main.includes('const hasTableHeaders = text.includes("SPU 기준")')) {
  throw new Error("known-good popular table detector missing");
}

main = replaceOnce(
  main,
  `    await captureVisibleSlots();\n  }\n  let products = networkProducts.length ? [...networkProducts] : [];`,
  `    await captureVisibleSlots();\n  }\n\n  // AI 기준 누락 순위 표적 재수집:\n  // 전체 표를 여러 번 다시 훑는 대신 실제로 비어 있는 순위만 계산해서\n  // 해당 순위의 약간 앞쪽으로 점프한 뒤 한 행 이하 간격으로 짧게 재스캔한다.\n  // 200/200이 아니면 완료로 보지 않는다.\n  for (let recoveryRound = 0; recoveryRound < 4 && rankSlots.size < limit; recoveryRound += 1) {\n    const missingRanks = Array.from({ length: limit }, (_, index) => index + 1).filter((rank) => !rankSlots.has(rank));\n    if (!missingRanks.length) break;\n    mainWindow?.webContents.send("seller:capture-progress", {\n      percent: 96 + recoveryRound,\n      count: rankSlots.size,\n      target: limit,\n      missing: missingRanks.length,\n      message: \`누락 순위 표적 재수집 \${recoveryRound + 1}/4 · \${missingRanks.slice(0, 24).join(", ")}\${missingRanks.length > 24 ? "…" : ""}\`,\n    });\n    for (const rank of missingRanks) {\n      if (rankSlots.has(rank)) continue;\n      await executeAcrossSellerFrames(sellerJumpScript(Math.max(1, rank - 3), limit));\n      await wait(500);\n      for (let scan = 0; scan < 10 && !rankSlots.has(rank); scan += 1) {\n        await captureVisibleSlots();\n        if (rankSlots.has(rank)) break;\n        await executeAcrossSellerFrames(SELLER_ROW_SCROLL_SCRIPT);\n        await wait(180);\n      }\n    }\n  }\n\n  let products = networkProducts.length ? [...networkProducts] : [];`,
  "targeted missing-rank recovery after full-table passes",
);

main = replaceOnce(
  main,
  `  mainWindow?.webContents.send("seller:capture-progress", {\n    percent: 100,\n    count: preservedSlots.size,\n    target: limit,\n    missing: limit - preservedSlots.size,\n    message: \`1~\${limit}번 순위 유지 · 상품 \${preservedSlots.size}개 · 누락 \${limit - preservedSlots.size}개\`,\n  });`,
  `  const finalMissing = limit - preservedSlots.size;\n  mainWindow?.webContents.send("seller:capture-progress", {\n    percent: rankSlots.size >= limit ? 100 : 99,\n    count: preservedSlots.size,\n    target: limit,\n    missing: finalMissing,\n    message: rankSlots.size >= limit\n      ? \`200/200 수집 완료 · 상품 \${preservedSlots.size}개\`\n      : \`누락 순위 재수집 필요 · 상품 \${preservedSlots.size}/\${limit} · 누락 \${finalMissing}개\`,\n  });`,
  "only report 100 percent when all 200 ranks are captured",
);

await writeFile(mainPath, main, "utf8");
console.log("popular list uses rank-driven recovery: targeted missing slots are re-scanned and 100% requires 200/200");
