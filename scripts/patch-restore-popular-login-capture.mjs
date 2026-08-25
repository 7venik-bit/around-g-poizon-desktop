import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`popular restore patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`popular restore patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  `  if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {\n    await sellerWindow.loadURL(SELLER_CENTER_URL);\n    await wait(1_800);\n    currentUrl = sellerWindow.webContents.getURL();\n    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {\n      revealSellerLogin();\n      return { ok: false, message: "판매자센터 로그인을 완료해 주세요. 로그인 세션은 다음 실행부터 자동으로 유지됩니다." };\n    }\n  }`,
  `  if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {\n    await sellerWindow.loadURL(SELLER_CENTER_URL);\n    await wait(1_800);\n    currentUrl = sellerWindow.webContents.getURL();\n    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {\n      // 인기리스트 수집도 브랜드 검색과 동일하게 저장된 POIZON 계정으로\n      // 자동 로그인을 먼저 수행한다. 수동 로그인 요구는 자동 입력/클릭 후에도\n      // 세션이 만들어지지 않은 경우에만 표시한다.\n      const automaticLogin = await submitStoredSellerCredentials();\n      if (automaticLogin?.ok) {\n        for (let attempt = 0; attempt < 30; attempt += 1) {\n          await wait(500);\n          currentUrl = sellerWindow.webContents.getURL();\n          if (!/login|signin|sign-in/i.test(currentUrl)) break;\n        }\n        await sellerWindow.loadURL("https://seller.poizon.com/main/dataCenter/merchantRankBoard");\n        await wait(1_800);\n        currentUrl = sellerWindow.webContents.getURL();\n      }\n      if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {\n        revealSellerLogin();\n        return { ok: false, message: automaticLogin?.stored === false\n          ? "POIZON 저장 계정을 먼저 등록해 주세요."\n          : "POIZON 자동 로그인 후에도 판매자센터 진입을 확인하지 못했습니다." };\n      }\n    }\n  }`,
  "auto-login before popular rank-board capture",
);
await writeFile(mainPath, main, "utf8");

const indexPath = new URL("../src/index.html", import.meta.url);
let index = normalizeLf(await readFile(indexPath, "utf8"));
index = replaceOnce(
  index,
  `        <div class="explorer-modes raw-data-modes">\n          <button class="explorer-mode active" data-explorer="brand"><strong>원본 데이터 가져오기</strong></button>\n          <button class="explorer-mode" data-explorer="files"><strong>받은 Excel 파일</strong></button>\n        </div>`,
  `        <div class="explorer-modes raw-data-modes">\n          <button class="explorer-mode active" data-explorer="brand"><strong>원본 데이터 가져오기</strong></button>\n          <button class="explorer-mode" data-explorer="popular"><strong>인기리스트</strong></button>\n          <button class="explorer-mode" data-explorer="files"><strong>받은 Excel 파일</strong></button>\n        </div>`,
  "restore popular-list mode button",
);
index = replaceOnce(
  index,
  `        <section id="explorer-popular" class="panel explorer-panel" hidden>`,
  `        <section id="explorer-popular" class="panel explorer-panel">`,
  "make popular-list panel routable",
);
await writeFile(indexPath, index, "utf8");

console.log("popular list UI, stored-account auto login, capture, and Excel staging path restored");
