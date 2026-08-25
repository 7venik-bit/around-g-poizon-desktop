import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`popular rank-board scope verification failed: ${message}`); };

if (!main.includes("rank-board route and rendered product rows are authoritative")) fail("resilient rank-board marker missing");
if (!main.includes("const rankBoardRoute = /merchantRankBoard/i")) fail("merchantRankBoard route evidence missing");
if (!main.includes("candidate.rows >= 3 && candidate.productLikeRows >= 1")) fail("rendered product-row evidence missing");
if (!main.includes("firstRow?.closest(\"table, [role='table'], [role='grid'], main, section, article\")")) fail("row-ancestor fallback missing");
if (main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("obsolete four-header gate still present");
if (!main.includes("scopeVerified: false, rankBoardRoute")) fail("scope failure diagnostics missing");

console.log("popular rank-board route/row scope detection verification passed");
