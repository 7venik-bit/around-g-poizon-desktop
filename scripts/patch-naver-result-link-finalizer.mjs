import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Cannot apply ${label}: expected one source anchor.`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'import { findNewSellerExportJob, findRecentSellerExportJob } from "./services/brand-export-jobs.mjs";',
  'import { findNewSellerExportJob, findRecentSellerExportJob } from "./services/brand-export-jobs.mjs";\nimport { createNaverFashionTownSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";',
  "Naver result finalizer import",
);

replaceOnce(
  '  const naverPortalSource = /^네이버\\s/.test(String(source.store || ""));',
  '  const naverPortalSource = /^네이버\\s/.test(String(source.store || ""));\n  const directNaverFashionResult = naverPortalSource\n    && String(source.store || "") === "네이버 패션타운"\n    && /shopping\\.naver\\.com\\/window\\/search\\//i.test(url);',
  "direct Naver Fashion Town result route",
);

replaceOnce(
  '  // NAVER_SINGLE_OVERVIEW_SEARCH_V1: one Fashion Town overview search is captured once, then each card is classified locally.',
  '  if (directNaverFashionResult) {\n    // Naver blocks the hidden Electron document even though the exact same URL\n    // works when opened by the user. The requested behavior is link-only, so\n    // do not turn an unusable hidden browser into a false verification failure.\n    return createNaverFashionTownSearchLinkResult({ articleNumber, resolvedSearchUrl: url });\n  }\n  // NAVER_SINGLE_OVERVIEW_SEARCH_V1: one Fashion Town overview search is captured once, then each card is classified locally.',
  "Naver direct result link without hidden browser verification",
);

replaceOnce(
  '      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;',
  '      // Fashion Town already provides an exact product-code result URL.\\n      // Load that URL directly instead of reopening Naver home and replaying\\n      // menu/input clicks that can fail before the usable result page.\\n      const initialUrl = directNaverFashionResult ? url\\n        : naverPortalSource ? "https://www.naver.com/" : url;'.replaceAll('\\n', '\n'),
  "direct Naver result initial URL",
);

replaceOnce(
  '      if (interactiveSiteSearch) {',
  '      if (interactiveSiteSearch && !directNaverFashionResult) {',
  "skip redundant Naver menu and search submission",
);

replaceOnce(
  String.raw`    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    if (state && !/페이지를\s*찾을\s*수\s*없습니다/.test(state.text)`,
  String.raw`    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    // Reaching the exact query result URL proves the input and magnifier action
    // succeeded. Final capture decides product presence or authoritative zero.
    if (isNaverRenderedResultReady(state, exactQuery)) return true;
    if (state && !/페이지를\s*찾을\s*수\s*없습니다/.test(state.text)`,
  "positive Naver result before the legacy stability gate",
);

replaceOnce(
  '        const aborted = /ERR_ABORTED/i.test(String(error?.message || ""));\n        const currentUrl = String(searchWindow.webContents.getURL() || "");',
  '        // Electron can reject loadURL while a commerce SPA replaces the\\n        // navigation with a usable HTTPS document. Trust the live document,\\n        // not the rejected promise or its error code.\\n        const currentUrl = String(searchWindow.webContents.getURL() || "");'.replaceAll('\\n', '\n'),
  "live document navigation comment",
);

replaceOnce(
  '        const documentReady = aborted && /^https:\\/\\//i.test(currentUrl)',
  '        const documentReady = /^https:\\/\\//i.test(currentUrl)',
  "live HTTPS document after Electron navigation replacement",
);

replaceOnce(
  String.raw`function renderedSearchFailure(reason, searchWindow = null, details = {}) {
  return {
    count: null,
    products: [],
    searchCompleted: false,
    searchSubmitted: details.searchSubmitted === true,
    verificationReason: String(reason || "search_failed"),
    securityVerificationRequired: details.securityVerificationRequired === true,
    loginRequired: details.loginRequired === true,
    resolvedSearchUrl: String(
      details.resolvedSearchUrl
      || (!searchWindow?.isDestroyed?.() ? searchWindow?.webContents?.getURL?.() : "")
      || "",
    ),
  };
}`,
  String.raw`function renderedSearchFailure(reason, searchWindow = null, details = {}) {
  const verificationReason = String(reason || "unknown_search_failure");
  const resolvedSearchUrl = String(
    details.resolvedSearchUrl
    || (!searchWindow?.isDestroyed?.() ? searchWindow?.webContents?.getURL?.() : "")
    || "",
  );
  const stageByReason = {
    naver_shopping_click_failed: "naver_navigation",
    fashion_town_click_failed: "naver_navigation",
    search_submission_failed: "search_submission",
    search_query_missing: "search_submission",
    result_parse_failed: "result_capture",
    result_analysis_failed: "result_capture",
    overview_channel_card_collection_failed: "result_capture",
    channel_count_detection_failed: "result_capture",
    page_load_timeout: "page_navigation",
    page_load_failed: "page_navigation",
    network_error: "page_navigation",
    security_verification_required: "access_verification",
    login_required: "access_verification",
  };
  const verificationStage = String(details.verificationStage || stageByReason[verificationReason] || "unknown");
  return {
    count: null,
    products: [],
    searchCompleted: false,
    searchSubmitted: details.searchSubmitted === true,
    verificationReason,
    verificationStage,
    verificationDiagnostics: {
      stage: verificationStage,
      reason: verificationReason,
      resolvedUrl: resolvedSearchUrl,
      errorMessage: String(details.errorMessage || ""),
      visibleResultCount: null,
      productCardCount: 0,
    },
    securityVerificationRequired: details.securityVerificationRequired === true,
    loginRequired: details.loginRequired === true,
    resolvedSearchUrl,
  };
}`,
  "failure stage diagnostics",
);

replaceOnce(
  '    return renderedSearchFailure(reason, searchWindow);',
  '    return renderedSearchFailure(reason, searchWindow, { errorMessage: message });',
  "raw navigation error diagnostics",
);

replaceOnce(
  String.raw`        const card = link.closest("li, article, [data-product-id], [data-item-id], [class*='product-card'], [class*='goods-item'], [class*='item-card'], [class*='cunit'], [class*='mnemitem'], [class*='item_unit'], [class*='itemUnit'], [class*='item_grid'], [class*='product_unit']")
          || link.parentElement;`,
  String.raw`        let card = link.closest("li, article, [data-product-id], [data-item-id], [class*='product-card'], [class*='goods-item'], [class*='item-card'], [class*='cunit'], [class*='mnemitem'], [class*='item_unit'], [class*='itemUnit'], [class*='item_grid'], [class*='product_unit']");
        // Fashion Town uses generated class names and often separates its image,
        // title and price anchors. Select the smallest owning result block that
        // contains an image and a price instead of trusting a class name.
        for (let node = link, depth = 0; node && depth < 9 && node !== document.body; node = node.parentElement, depth += 1) {
          const nodeText = String(node.innerText || node.textContent || "").trim();
          if (node.querySelector?.("img") && /[\\d,]+\\s*원/.test(nodeText) && nodeText.length <= 5000) {
            card = node;
            break;
          }
        }
        card ||= link.parentElement;`,
  "generated-class Naver product card detection",
);

replaceOnce(
  String.raw`      const selectedChannelEmpty = /검색된\s*상품이\s*없(?:습니다|어)|검색\s*결과가?\s*없(?:습니다|어)|상품이\s*없(?:습니다|어)|검색결과\s*없음/i.test(fullPageText);`,
  String.raw`      const selectedChannelEmpty = /검색된\\s*상품이\\s*없(?:습니다|어)|검색\\s*결과가?\\s*없(?:습니다|어)|상품이\\s*없(?:습니다|어)|검색결과\\s*없음/i.test(fullPageText);
      const visibleCountMatches = [...fullPageText.matchAll(/(?:전체|검색\\s*결과)\\s*([\\d,]+)\\s*개/gi)];
      const visibleResultCountObserved = visibleCountMatches.length > 0;
      const visibleResultCount = visibleCountMatches.reduce((maximum, match) =>
        Math.max(maximum, Number(String(match[1] || "0").replace(/,/g, "")) || 0), 0);`,
  "visible Naver result count",
);

replaceOnce(
  String.raw`      const pageBlocked = /captcha|보안\s*확인|자동\s*입력|로봇|접속.{0,12}(?:제한|차단)|서비스.{0,12}(?:제한|지연)|비정상적인\s*접근/i.test(pageText);
      return JSON.stringify({ productCards, pageBlocked, pageText, pageHeaderText, selectedChannelEmpty, selectedChannelCount });`,
  String.raw`      const pageBlocked = /captcha|보안\\s*확인|자동\\s*입력|로봇|접속.{0,12}(?:제한|차단)|서비스.{0,12}(?:제한|지연)|비정상적인\\s*접근/i.test(pageText);
      return JSON.stringify({
        productCards, pageBlocked, pageText, pageHeaderText, selectedChannelEmpty, selectedChannelCount,
        visibleResultCount, visibleResultCountObserved,
      });`,
  "Naver snapshot evidence",
);

replaceOnce(
  String.raw`    } catch {
      return renderedSearchFailure("result_parse_failed", searchWindow, { searchSubmitted: interactiveSiteSearch });
    }
    if (naverPortalSource) {`,
  String.raw`    } catch {
      return renderedSearchFailure("result_parse_failed", searchWindow, { searchSubmitted: interactiveSiteSearch });
    }
    if (naverPortalSource && String(source.store || "") === "네이버 패션타운") {
      // The requested output is Naver's rendered result list itself. Do not run
      // those links through the generic brand/article matcher again: the exact
      // query was already submitted and that second gate discarded real cards.
      return finalizeNaverFashionTownResult(parsedContent, {
        articleNumber,
        resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
      });
    }
    if (naverPortalSource) {`,
  "Naver Fashion Town finalizer",
);

replaceOnce(
  String.raw`        verificationPending: result?.detailVerificationPending === true
          || (Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed),
        absenceConfirmed,`,
  String.raw`        verificationPending: result?.resultLinkOnly === true ? false : (
          result?.detailVerificationPending === true
          || result?.verificationPending === true
          || (Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed)),
        absenceConfirmed,
        presenceConfirmed: result?.presenceConfirmed === true,
        resultLinkOnly: result?.resultLinkOnly === true,`,
  "Naver presence and pending propagation",
);

replaceOnce(
  '        verificationReason: String(result?.verificationReason || ""),',
  '        verificationReason: String(result?.verificationReason || ""),\n        verificationStage: String(result?.verificationStage || result?.verificationDiagnostics?.stage || ""),\n        verificationDiagnostics: result?.verificationDiagnostics || {\n          stage: String(result?.verificationStage || "result_aggregation"),\n          reason: String(result?.verificationReason || ""),\n          resolvedUrl: String(result?.resolvedSearchUrl || source.searchUrl || ""),\n          visibleResultCount: Number.isFinite(count) ? Number(count) : null,\n          productCardCount: Number(result?.candidateCount || result?.products?.length || 0),\n        },\n        naverAllSearchVerdict: result?.naverAllSearchVerdict || null,',
  "Naver verdict propagation",
);

await writeFile(mainPath, source, "utf8");
console.log("Naver result-link finalizer patch applied.");
