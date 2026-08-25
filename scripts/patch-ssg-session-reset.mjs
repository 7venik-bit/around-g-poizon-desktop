import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`SSG session-reset patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`SSG session-reset patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

main = replaceOnce(
  main,
  `      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {\n        if (securityRetry >= 1 || !/naver\\.com/i.test(String(searchWindow.webContents.getURL() || url))) {\n          return renderedSearchFailure("security_verification_required", searchWindow, {\n            searchSubmitted: interactiveSiteSearch,\n            securityVerificationRequired: true,\n          });\n        }`,
  `      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {\n        if (ssgChannelSource && securityRetry < 1) {\n          // SSG 접근 제한이 확인되면 이 사이트의 저장 데이터와 검색 캐시를\n          // 한 번만 초기화하고 새 창에서 같은 검색을 딱 한 번 다시 시도한다.\n          // 다른 국내 사이트의 로그인 쿠키는 건드리지 않는다.\n          const ssgSession = searchWindow.webContents.session;\n          try {\n            await ssgSession.clearStorageData({\n              origin: "https://www.ssg.com",\n              storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"],\n            });\n            await ssgSession.clearCache();\n          } catch {}\n          if (!searchWindow.isDestroyed()) searchWindow.destroy();\n          searchWindow = null;\n          await wait(800);\n          return renderedSearchSourceResult(\n            source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession,\n          );\n        }\n        if (securityRetry >= 1 || !/naver\\.com/i.test(String(searchWindow.webContents.getURL() || url))) {\n          return renderedSearchFailure(\n            ssgChannelSource && securityRetry >= 1\n              ? "ssg_access_limited_after_session_reset"\n              : "security_verification_required",\n            searchWindow,\n            {\n              searchSubmitted: interactiveSiteSearch,\n              securityVerificationRequired: true,\n              ssgSessionResetAttempted: ssgChannelSource && securityRetry >= 1,\n            },\n          );\n        }`,
  "reset SSG session once when blocked",
);

main = replaceOnce(
  main,
  `    const blockedSsg = /^SSG(?:\\s|$)/.test(String(source.store || ""))\n      && (resolvedSource.securityVerificationRequired === true\n        || String(resolvedSource.verificationReason || "") === "security_verification_required");`,
  `    const blockedSsg = /^SSG(?:\\s|$)/.test(String(source.store || ""))\n      && resolvedSource.ssgSessionResetAttempted !== true\n      && (resolvedSource.securityVerificationRequired === true\n        || String(resolvedSource.verificationReason || "") === "security_verification_required");`,
  "do not defer SSG again after session-reset retry",
);

await writeFile(mainPath, main, "utf8");
console.log("SSG session-reset-on-block patch applied");
