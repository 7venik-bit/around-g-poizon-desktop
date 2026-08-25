import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`next-day access verification failed: ${message}`); };

if (!main.includes("function domesticAccessCooldownKey(source)")) fail("cooldown key helper missing");
if (!main.includes("function activeDomesticAccessCooldown(source)")) fail("active cooldown helper missing");
if (!main.includes("async function postponeDomesticSourceUntilTomorrow(source")) fail("postpone helper missing");
if (!main.includes("until.setDate(until.getDate() + 1)")) fail("next-day calculation missing");
if (!main.includes("until.setHours(0, 5, 0, 0)")) fail("next-day resume time missing");
if (!main.includes("domesticAccessCooldowns")) fail("persistent cooldown storage missing");
if (!main.includes("verificationReason: \"access_limited_until_tomorrow\"")) fail("skip result reason missing");
if (!main.includes("temporaryAccessLimited: true")) fail("temporary access marker missing");
if (!main.includes("if (/^네이버(?:\\s|$)/.test(String(source?.store || \"\"))) return null;")) fail("Naver exclusion missing");
if (!sourcing.includes('label: "내일 재시도"')) fail("next-day retry UI label missing");

console.log("next-day access cooldown verification passed");
