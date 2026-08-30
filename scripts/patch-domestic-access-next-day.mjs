import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`next-day access patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`next-day access patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

const legacyFunctionMarker = "async function renderedSearchSourceResult(source, articleNumber, brand = \"\", title = \"\", securityRetry = 0, searchAttempt = null, sharedNaverSession = null) {";
const cancelableFunctionMarker = "async function renderedSearchSourceResult(source, articleNumber, brand = \"\", title = \"\", securityRetry = 0, searchAttempt = null, sharedNaverSession = null, generation = domesticSearchGeneration) {";
const functionMarker = main.includes(cancelableFunctionMarker) ? cancelableFunctionMarker : legacyFunctionMarker;
const helperBlock = `function domesticAccessCooldownKey(source) {\n  return String(source?.store || source?.homepageUrl || source?.searchUrl || \"unknown\")\n    .trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, \"_\").replace(/^_+|_+$/g, \"\") || \"unknown\";\n}\n\nfunction activeDomesticAccessCooldown(source) {\n  // 네이버 패션타운은 기존 검색 흐름을 그대로 유지한다.\n  if (/^네이버(?:\\s|$)/.test(String(source?.store || \"\"))) return null;\n  const key = domesticAccessCooldownKey(source);\n  const entry = store?.data?.settings?.domesticAccessCooldowns?.[key];\n  if (!entry?.until) return null;\n  const until = new Date(entry.until);\n  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) return null;\n  return entry;\n}\n\nasync function postponeDomesticSourceUntilTomorrow(source, reason = \"temporary_access_limited\") {\n  if (/^네이버(?:\\s|$)/.test(String(source?.store || \"\"))) return null;\n  const now = new Date();\n  const until = new Date(now);\n  until.setDate(until.getDate() + 1);\n  until.setHours(0, 5, 0, 0);\n  const key = domesticAccessCooldownKey(source);\n  const previous = store?.data?.settings?.domesticAccessCooldowns || {};\n  const entry = {\n    store: String(source?.store || \"\"),\n    reason: String(reason || \"temporary_access_limited\"),\n    detectedAt: now.toISOString(),\n    until: until.toISOString(),\n  };\n  if (store?.setSettings) {\n    await store.setSettings({ domesticAccessCooldowns: { ...previous, [key]: entry } });\n  }\n  return entry;\n}\n\n`;
main = replaceOnce(main, functionMarker, helperBlock + functionMarker, "cooldown helpers");

const ssgLineStart = main.indexOf("  const ssgChannelSource = ", main.indexOf(functionMarker));
if (ssgLineStart < 0) throw new Error("next-day access patch target missing: SSG source marker");
const ssgLineEnd = main.indexOf("\n", ssgLineStart);
if (ssgLineEnd < 0) throw new Error("next-day access patch target missing: SSG source line ending");
const cooldownGuard = `\n  const activeAccessCooldown = activeDomesticAccessCooldown(source);\n  if (activeAccessCooldown) {\n    return {\n      count: 0, products: [], error: true, skipped: true, temporaryAccessLimited: true,\n      accessLimitedUntil: activeAccessCooldown.until,\n      verificationReason: \"access_limited_until_tomorrow\",\n      store: String(source.store || \"\"),\n    };\n  }`;
main = main.slice(0, ssgLineEnd) + cooldownGuard + main.slice(ssgLineEnd);

const blockedMarker = "      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {";
const blockedIndex = main.indexOf(blockedMarker);
if (blockedIndex < 0) throw new Error("next-day access patch target missing: blocked page branch");
const ssgResetMarker = "        if (ssgChannelSource && securityRetry < 1) {";
const ssgResetIndex = main.indexOf(ssgResetMarker, blockedIndex);
if (ssgResetIndex < 0) throw new Error("next-day access patch target missing: SSG reset branch");
const genericBlock = `        if (!ssgChannelSource && !naverPortalSource) {\n          const cooldown = await postponeDomesticSourceUntilTomorrow(source, \"temporary_access_limited\");\n          return renderedSearchFailure(\"access_limited_until_tomorrow\", searchWindow, {\n            searchSubmitted: interactiveSiteSearch,\n            securityVerificationRequired: true,\n            temporaryAccessLimited: true,\n            accessLimitedUntil: cooldown?.until || \"\",\n          });\n        }\n`;
main = main.slice(0, ssgResetIndex) + genericBlock + main.slice(ssgResetIndex);

const ssgFailureMarker = `          return renderedSearchFailure(\n            ssgChannelSource && securityRetry >= 1\n              ? \"ssg_access_limited_after_session_reset\"\n              : \"security_verification_required\",\n            searchWindow, {`;
const ssgFailureIndex = main.indexOf(ssgFailureMarker, ssgResetIndex + genericBlock.length);
if (ssgFailureIndex < 0) throw new Error("next-day access patch target missing: SSG post-reset failure");
const ssgFailureReplacement = `          const cooldown = ssgChannelSource && securityRetry >= 1\n            ? await postponeDomesticSourceUntilTomorrow(source, \"ssg_access_limited_after_session_reset\")\n            : null;\n          return renderedSearchFailure(\n            ssgChannelSource && securityRetry >= 1\n              ? \"access_limited_until_tomorrow\"\n              : \"security_verification_required\",\n            searchWindow, {\n              temporaryAccessLimited: Boolean(cooldown),\n              accessLimitedUntil: cooldown?.until || \"\",`;
main = main.slice(0, ssgFailureIndex) + ssgFailureReplacement + main.slice(ssgFailureIndex + ssgFailureMarker.length);

await writeFile(mainPath, main, "utf8");

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
const sourcing = normalizeLf(await readFile(sourcingPath, "utf8"));
const verdict = normalizeLf(await readFile(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8"));
const canonicalCooldownLabel = verdict.includes("result?.accessLimitedUntil")
  && verdict.includes('label: "내일 재시도"');
const legacyCooldownLabel = sourcing.includes("result?.accessLimitedUntil")
  && sourcing.includes('label: "내일 재시도"');
if (!canonicalCooldownLabel && !legacyCooldownLabel) {
  throw new Error("next-day access patch target missing: canonical retry label");
}

console.log("temporary mall access blocks use the canonical next-day retry verdict");
