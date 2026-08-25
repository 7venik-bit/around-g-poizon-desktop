import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

const blockedStart = '      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {';
const blockedIndex = main.indexOf(blockedStart);
if (blockedIndex < 0) throw new Error("SSG session-reset patch target missing: blocked page branch");

const guardMarker = '        if (securityRetry >= 1 || !/naver\\.com/i.test(String(searchWindow.webContents.getURL() || url))) {';
const guardIndex = main.indexOf(guardMarker, blockedIndex);
if (guardIndex < 0) throw new Error("SSG session-reset patch target missing: blocked page retry guard");

const resetBranch = `        if (ssgChannelSource && securityRetry < 1) {\n          // SSG 접근 제한이 확인되면 이 사이트의 저장 데이터와 검색 캐시를\n          // 한 번만 초기화하고 새 창에서 같은 검색을 딱 한 번 다시 시도한다.\n          // 다른 국내 사이트의 로그인 쿠키는 건드리지 않는다.\n          const ssgSession = searchWindow.webContents.session;\n          try {\n            await ssgSession.clearStorageData({\n              origin: "https://www.ssg.com",\n              storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"],\n            });\n            await ssgSession.clearCache();\n          } catch {}\n          if (!searchWindow.isDestroyed()) searchWindow.destroy();\n          searchWindow = null;\n          await wait(800);\n          return renderedSearchSourceResult(\n            source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession,\n          );\n        }\n`;
main = main.slice(0, guardIndex) + resetBranch + main.slice(guardIndex);

const failureMarker = '          return renderedSearchFailure("security_verification_required", searchWindow, {';
const failureIndex = main.indexOf(failureMarker, guardIndex + resetBranch.length);
if (failureIndex < 0) throw new Error("SSG session-reset patch target missing: blocked page failure");
const conditionalFailure = `          return renderedSearchFailure(\n            ssgChannelSource && securityRetry >= 1\n              ? "ssg_access_limited_after_session_reset"\n              : "security_verification_required",\n            searchWindow, {`;
main = main.slice(0, failureIndex) + conditionalFailure + main.slice(failureIndex + failureMarker.length);

const blockedSsgMarker = `    const blockedSsg = /^SSG(?:\\s|$)/.test(String(source.store || ""))\n      && (resolvedSource.securityVerificationRequired === true\n        || String(resolvedSource.verificationReason || "") === "security_verification_required");`;
const blockedSsgIndex = main.indexOf(blockedSsgMarker);
if (blockedSsgIndex < 0) throw new Error("SSG session-reset patch target missing: deferred SSG queue guard");
const blockedSsgReplacement = `    const blockedSsg = /^SSG(?:\\s|$)/.test(String(source.store || ""))\n      && String(resolvedSource.verificationReason || "") !== "ssg_access_limited_after_session_reset"\n      && (resolvedSource.securityVerificationRequired === true\n        || String(resolvedSource.verificationReason || "") === "security_verification_required");`;
main = main.slice(0, blockedSsgIndex) + blockedSsgReplacement + main.slice(blockedSsgIndex + blockedSsgMarker.length);

await writeFile(mainPath, main, "utf8");
console.log("SSG session-reset-on-block patch applied");
