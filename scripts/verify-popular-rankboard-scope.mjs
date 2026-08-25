import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`popular rank-board scope verification failed: ${message}`); };

if (!main.includes("video-confirmed popular ranking table")) fail("video-confirmed ranking-table marker missing");
if (!main.includes("const rankBoardRoute = /merchantRankBoard/i")) fail("merchantRankBoard route evidence missing");
if (!main.includes("const hasNoHeader")) fail("No. header anchor missing");
if (!main.includes("const hasProductInfo")) fail("상품정보 header anchor missing");
if (!main.includes("candidate.videoHeaderMatch && candidate.rows >= 2 && candidate.productRows >= 1")) fail("video table evidence gate missing");
if (!main.includes("/^\\s*\\d{1,3}\\b/")) fail("rank-number row evidence missing");
if (!main.includes("firstRow?.closest(\"table,[role='table'],[role='grid'],section,article,main\")")) fail("rank-row ancestor fallback missing");
if (main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("obsolete four-header gate still present");
if (!main.includes("videoHeaderExpected: true")) fail("video scope failure diagnostics missing");

console.log("popular rank-board video table scope verification passed");
