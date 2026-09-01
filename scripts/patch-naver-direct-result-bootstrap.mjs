import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Cannot patch ${label}: expected one source anchor.`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const originalBootstrap = `      // Establish Naver cookies/session on the normal home page first. A
      // cold hidden window can reject a direct Fashion Town SPA navigation.
      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;`;

const patchedBootstrap = `      // Direct Fashion Town result URLs must not depend on a Naver-home bootstrap.
      // The home navigation is the recurring source of Electron page-load failures.
      const initialUrl = directNaverFashionResult
        ? url
        : (naverPortalSource ? "https://www.naver.com/" : url);
      /*
      // Establish Naver cookies/session on the normal home page first. A
      // cold hidden window can reject a direct Fashion Town SPA navigation.
      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;
      */`;

replaceOnce(originalBootstrap, patchedBootstrap, "Naver direct-result bootstrap");

const originalFailure = `        if (!resultPage.ok) {
          return renderedSearchFailure(
            resultPage.timeout ? "page_load_timeout"
              : resultPage.networkError ? "network_error" : "page_load_failed",
            searchWindow, {
              searchSubmitted: true,
              resolvedSearchUrl: resultPage.resolvedUrl || url,
              errorMessage: resultPage.errorMessage,
            },
          );
        }`;

const patchedFailure = `        if (!resultPage.ok) {
          // Naver's Fashion Town SPA can reject or abort Electron navigation even
          // when the exact user-search URL itself is valid in a normal browser.
          // This is a technical renderer failure, not proof that the product is
          // absent. Preserve the exact search URL as the usable result instead of
          // showing page_load_failed or advancing to another query.
          return {
            count: 0,
            products: [],
            presenceConfirmed: false,
            absenceConfirmed: false,
            searchCompleted: true,
            searchSubmitted: true,
            resolvedSearchUrl: resultPage.resolvedUrl || url,
            resultLinkOnly: true,
            detailVerificationPending: false,
            verificationPending: false,
            verificationReason: "naver_result_link_fallback",
            verificationStage: "page_navigation",
            verificationDiagnostics: {
              stage: "page_navigation",
              reason: "naver_result_link_fallback",
              resolvedUrl: resultPage.resolvedUrl || url,
              errorMessage: String(resultPage.errorMessage || ""),
              productCardCount: 0,
              visibleResultCount: null,
            },
          };
        }`;

replaceOnce(originalFailure, patchedFailure, "Naver page-load link fallback");

await writeFile(mainPath, source, "utf8");
console.log("Naver direct Fashion Town result bootstrap and link fallback patched");
