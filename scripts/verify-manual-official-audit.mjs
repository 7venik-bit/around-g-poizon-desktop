import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const releasePatch = await readFile(new URL("./patch-domestic-authenticity-guide.mjs", import.meta.url), "utf8");

assert.match(main, /if \(automatic\) \{[\s\S]*manualOnly: true/,
  "the main process must reject automatic official-store audit requests");
assert.match(renderer, /startOfficialDomainAudit\(\{ recheckAll: true \}\)/,
  "the official-store button must start a full audit on a user click");
assert.doesNotMatch(renderer, /queueFavoriteBrandSiteLinkage|startOfficialDomainAudit\(\{[^}]*automatic: true/,
  "the shipped renderer must not queue an audit while rendering favorite brands");
assert.doesNotMatch(releasePatch, /import\("\.\/patch-favorite-brand-auto-link\.mjs"\)/,
  "the release transformation must not inject startup favorite audits");

console.log("Official-store audit is manual-only: startup and favorite rendering cannot launch it; the button still starts a full audit.");
