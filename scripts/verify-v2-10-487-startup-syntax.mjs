import { readFile } from "node:fs/promises";

const patch = String(await readFile(new URL("./patch-naver-result-stability.mjs", import.meta.url), "utf8"));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`startup syntax fix verification failed: ${message}`); };

if (!patch.includes("waitForNaverSearchResultsStablePatch.toString()")) fail("safe Function#toString injection missing");
if (patch.includes('exactQuery.replace(/\\\\/g')) fail("legacy nested query escaping remains");
if (!String(pkg.scripts?.postinstall || "").includes("node --check main.mjs")) fail("final main syntax check missing from postinstall");

console.log("v2.10.487 startup syntax fix verified");
