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
  'import { findNewSellerExportJob, findRecentSellerExportJob } from "./services/brand-export-jobs.mjs";\nimport { finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";',
  "Naver result finalizer import",
);

replaceOnce(
  String.raw`    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    if (state && !/페이지를\s*찾을\s*수\s*없습니다/.test(state.text)`,
  String.raw`    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    // The exact result URL plus the visible query and a positive total prove
    // the search succeeded even if Naver changed the product-link selector.
    if (isNaverRenderedResultReady(state, exactQuery)) return true;
    if (state && !/페이지를\s*찾을\s*수\s*없습니다/.test(state.text)`,
  "positive Naver result before the legacy stability gate",
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
  String.raw`        verificationPending: result?.detailVerificationPending === true
          || result?.verificationPending === true
          || (Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed),
        absenceConfirmed,
        presenceConfirmed: result?.presenceConfirmed === true,`,
  "Naver presence and pending propagation",
);

replaceOnce(
  '        verificationReason: String(result?.verificationReason || ""),',
  '        verificationReason: String(result?.verificationReason || ""),\n        naverAllSearchVerdict: result?.naverAllSearchVerdict || null,',
  "Naver verdict propagation",
);

await writeFile(mainPath, source, "utf8");
console.log("Naver result-link finalizer patch applied.");
