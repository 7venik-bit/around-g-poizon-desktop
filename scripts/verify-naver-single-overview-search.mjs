import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`single Naver overview verification failed: ${message}`); };

if (!main.includes("NAVER_SINGLE_OVERVIEW_SEARCH_V1")) fail("main marker missing");
if (!relay.includes("NAVER_SINGLE_OVERVIEW_SEARCH_V1")) fail("relay marker missing");
if (main.includes("searchWindow.loadURL(sharedNaverSession.resultsUrl)")) fail("shared Naver results are still reloaded");
if (!main.includes("const naverChannelClickRequired = false;")) fail("Naver channel clicking is still enabled");
if (!main.includes('naverWholeViewChannel = /\\/window-products\\/department\\//i.test(productUrl)')) fail("overview card classification missing");
if (!main.includes('String(card?.naverWholeViewChannel || "") === expectedNaverChannel')) fail("overview cards are not split locally by channel");
if (main.includes('return renderedSearchFailure("channel_count_detection_failed"')) fail("channel counts are still a hard prerequisite");
if (!relay.includes("const overviewChannel = String(card?.naverWholeViewChannel || \"\")")) fail("relay does not trust overview classification");
if (relay.includes('^네이버\\s/.test(String(store || "")) && cards.length === 1\n          && brandMatched && titleIdentityMatch')) fail("Naver title fallback is still restricted to one card");
if (!relay.includes("&& brandMatched && titleIdentityMatch(rawCardText, expectedTitle)\n          && isPlatformShoppingProductUrl(productUrl)")) fail("strong Naver title/brand fallback missing");

console.log("single Naver overview search verified");
