import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`popular full-scroll verification failed: ${message}`); };

if (!main.includes("rank-board route and rendered product rows are authoritative")) fail("resilient rank-board scope marker missing");
if (!main.includes("const rankBoardRoute = /merchantRankBoard/i")) fail("merchantRankBoard route evidence missing");
if (!main.includes("candidate.rows >= 3 && candidate.productLikeRows >= 1")) fail("rendered row evidence missing");
if (main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("obsolete four-header scope gate still present");
if (!main.includes("POIZON 인기상품 표는 가상 스크롤")) fail("virtual-scroll accumulation marker missing");
if (!main.includes("for (let attempt = 0; attempt < 80; attempt += 1)")) fail("full ranking scroll loop missing");
if (!main.includes("scrollTarget.scrollTop = 0")) fail("popular list does not reset to rank-board top before capture");
if (!main.includes("scrollTarget.scrollTop = Math.min(maximum, scrollTarget.scrollTop + step)")) fail("incremental scroll movement missing");
if (!main.includes("collectVisibleRows();\n      const maximum = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);")) fail("visible rows are not accumulated on every scroll step");
if (!main.includes("if (atEnd && stableReads >= 3) break;")) fail("end-of-list stabilization check missing");
if (!main.includes("tbody tr, tr, [role='row'], [data-row-key]")) fail("rank-board row-oriented selector missing");

console.log("popular rank-board scope and full virtual-scroll accumulation verification passed");
