import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let main = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const helperName = "waitForNaverSearchResultsStable";
if (main.includes(`async function ${helperName}(`)) {
  console.log("Naver result stability patch already applied");
  process.exit(0);
}

const submitAnchor = "async function submitNaverShoppingSearch(searchWindow, query) {";
if (!main.includes(submitAnchor)) throw new Error("submitNaverShoppingSearch anchor missing");

// Define the helper as real JavaScript and inject Function#toString output.
// This preserves regex/backslash syntax exactly and avoids the nested string
// escaping bug that produced an invalid regular expression in v2.10.487.
async function waitForNaverSearchResultsStablePatch(searchWindow, query) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  const exactQuery = String(query || "").trim();
  if (!exactQuery) return false;
  const deadline = Date.now() + 15_000;
  let previousSignature = "";
  let stableSamples = 0;
  while (Date.now() < deadline) {
    if (searchWindow.isDestroyed()) return false;
    const pageScript = `(() => {
      const query = ${JSON.stringify(exactQuery)};
      const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
      const expected = compact(query);
      const bodyText = String(document.body?.innerText || "");
      const queryVisible = expected && (compact(bodyText).includes(expected)
        || [...document.querySelectorAll('input:not([type="password"]),textarea,[role="searchbox"]')]
          .some((input) => compact(input.value || input.textContent).includes(expected)));
      const productLinks = [...document.querySelectorAll('a[href*="window-products"],a[href*="/products/"]')]
        .map((link) => ({ href: String(link.href || ""), text: String(link.innerText || link.textContent || "").trim() }))
        .filter((item) => /^https?:\/\//i.test(item.href));
      const unique = [];
      const seen = new Set();
      for (const item of productLinks) {
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        unique.push(item);
        if (unique.length >= 24) break;
      }
      const noResult = /검색된\s*상품이\s*없습니다|검색\s*결과가\s*없습니다|상품이\s*없습니다|검색결과\s*없음/i.test(bodyText);
      const securityRequired = /captcha|보안\s*확인|자동\s*입력|로봇|스팸을\s*방지|실제\s*사용자|비정상적인\s*접근/i.test(bodyText);
      const signature = unique.map((item) => item.href + "|" + compact(item.text).slice(0, 80)).join("||");
      return { queryVisible, noResult, securityRequired, cardCount: unique.length, signature };
    })()`;
    const state = await searchWindow.webContents.executeJavaScript(pageScript, true).catch(() => null);
    if (!state || state.securityRequired) return false;
    const ready = state.queryVisible === true && (state.cardCount > 0 || state.noResult === true);
    const signature = state.noResult === true ? "__NO_RESULT__" : String(state.signature || "");
    if (ready && signature && signature === previousSignature) stableSamples += 1;
    else stableSamples = ready && signature ? 1 : 0;
    previousSignature = ready ? signature : "";
    if (stableSamples >= 4) {
      // Keep the rendered result visible briefly after DOM stability so lazy
      // card metadata and images can finish committing before extraction.
      await wait(1_500);
      return true;
    }
    await wait(500);
  }
  return false;
}

const helper = `${waitForNaverSearchResultsStablePatch.toString()
  .replace("waitForNaverSearchResultsStablePatch", helperName)}\n\n`;
main = main.replace(submitAnchor, `${helper}${submitAnchor}`);

const functionStart = main.indexOf(submitAnchor);
const functionEnd = main.indexOf("\nasync function openRenderedSizeOptions", functionStart);
if (functionStart < 0 || functionEnd < 0) throw new Error("submitNaverShoppingSearch boundary missing");
let submitFunction = main.slice(functionStart, functionEnd);
const readyTail = "|| (state.noResult === true && queryVisibleInPage))) return true;";
if (!submitFunction.includes(readyTail)) throw new Error("Naver early-success tail missing");
submitFunction = submitFunction.replace(
  readyTail,
  "|| (state.noResult === true && queryVisibleInPage))) return await waitForNaverSearchResultsStable(searchWindow, exactQuery);",
);
main = `${main.slice(0, functionStart)}${submitFunction}${main.slice(functionEnd)}`;

const closeBlock = `    if (source.store === "네이버 아울렛"
      && sharedNaverSession.window
      && !sharedNaverSession.window.isDestroyed()) {
      sharedNaverSession.window.destroy();
      sharedNaverSession.window = null;
    }`;
if (!main.includes(closeBlock)) throw new Error("shared Naver close block missing");
main = main.replace(closeBlock, `    if (source.store === "네이버 아울렛"
      && sharedNaverSession.window
      && !sharedNaverSession.window.isDestroyed()) {
      // The shared Naver window is closed only after every source result has
      // been resolved and pushed. This is a post-capture grace period, not a
      // substitute for the DOM-stability gate above.
      await wait(2_000);
      sharedNaverSession.window.destroy();
      sharedNaverSession.window = null;
    }`);

await writeFile(mainPath, main, "utf8");
console.log("Naver search waits for stable rendered results before capture and close");
