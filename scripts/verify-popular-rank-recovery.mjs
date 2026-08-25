import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`popular-rank recovery verification failed: ${message}`); };

if (!main.includes("AI 기준 누락 순위 표적 재수집")) fail("targeted missing-rank recovery marker missing");
if (!main.includes("for (let recoveryRound = 0; recoveryRound < 4 && rankSlots.size < limit; recoveryRound += 1)")) fail("bounded recovery rounds missing");
if (!main.includes("const missingRanks = Array.from({ length: limit }, (_, index) => index + 1).filter((rank) => !rankSlots.has(rank));")) fail("missing-rank set is not built from 1-200 slots");
if (!main.includes("sellerJumpScript(Math.max(1, rank - 3), limit)")) fail("targeted jump before missing rank missing");
if (!main.includes("for (let scan = 0; scan < 10 && !rankSlots.has(rank); scan += 1)")) fail("local row-by-row rescan missing");
if (!main.includes("percent: rankSlots.size >= limit ? 100 : 99")) fail("completion percent is not gated by 200/200");
if (!main.includes("200/200 수집 완료")) fail("complete message missing");
if (!main.includes("누락 순위 재수집 필요")) fail("incomplete message missing");

console.log("popular ranking targeted recovery and 200/200 completion gating verified");
