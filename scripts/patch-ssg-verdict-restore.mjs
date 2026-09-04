import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`SSG patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`SSG patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  `      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {\n        if (securityRetry >= 1 || !/naver\\.com/i.test(String(searchWindow.webContents.getURL() || url))) {`,
  `      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {\n        // SSG occasionally serves a security/interstitial document to a hidden\n        // Chromium window even though the same exact-code URL works in normal\n        // Chrome. Keep SSG visible, give the site one normal-browser settling\n        // cycle, and retry the exact same query once. A blocked page is never\n        // converted to "상품 없음"; only a parsed result grid may prove absence.\n        if (ssgChannelSource && securityRetry < 1) {\n          searchWindow.show();\n          searchWindow.maximize();\n          searchWindow.focus();\n          await wait(8_000);\n          searchWindow.destroy();\n          searchWindow = null;\n          return renderedSearchSourceResult(source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession);\n        }\n        if (securityRetry >= 1 || !/naver\\.com/i.test(String(searchWindow.webContents.getURL() || url))) {`,
  "SSG security retry without false absence",
);
await writeFile(mainPath, main, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
relay = replaceOnce(
  relay,
  `    { store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },\n    { store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },\n    { store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },`,
  `    // SSG 통합검색 한 번에서 정확 품번 카드를 판정한다. 백화점/아울렛은\n    // 같은 결과 카드의 판매처 라벨로 구분하며 동일 품번을 세 번 재검색하지 않는다.\n    { store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },`,
  "single SSG integrated search",
);
await writeFile(relayPath, relay, "utf8");

console.log("SSG verdict restore patch applied");
