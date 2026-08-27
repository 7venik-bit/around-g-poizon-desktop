import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`Naver result stability verification failed: ${message}`); };

if (!main.includes("async function waitForNaverSearchResultsStable(searchWindow, query)")) fail("stability helper missing");
if (!main.includes("stableSamples >= 4")) fail("consecutive stability gate missing");
if (!main.includes("return await waitForNaverSearchResultsStable(searchWindow, exactQuery);")) fail("early-success path still bypasses stability gate");
if (main.includes("|| (state.noResult === true && queryVisibleInPage))) return true;")) fail("legacy early success remains");
if (!main.includes("post-capture grace period")) fail("post-capture close guard missing");
if (!main.includes("await wait(2_000);\n      sharedNaverSession.window.destroy();")) fail("Naver window still closes immediately");

console.log("Naver rendered-result stability and delayed close verified");
