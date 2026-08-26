import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`official-result patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`official-result patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(main,
  'import { mergeSellerProductsByRank, parseSellerDomNodes } from "./services/seller-dom.mjs";',
  'import { mergeSellerProductsByRank, parseSellerDomNodes } from "./services/seller-dom.mjs";\nimport { evaluateDomesticProductCards } from "./services/domestic-card-verdict.mjs";',
  "import shared domestic product-card verdict engine");
main = replaceOnce(main,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;\n  await wait(2_000);\n  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);`,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  // 일부 공식몰은 실제 검색 결과 화면까지 이동해도 사이트 이벤트 처리 방식 때문에\n  // submit 함수가 false를 반환할 수 있다. 최종 화면을 다시 확인해 성공 여부를 판정한다.\n  await wait(submitted ? 2_000 : 1_200);\n  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);`,
  "accept rendered official-mall result when submit signal is false");

main = replaceOnce(main,
  `      const trustedChannelEvidence = /브랜드직영몰\\s*[1-9]\\d*\\s*개|백화점\\s*[1-9]\\d*\\s*개|아울렛\\s*[1-9]\\d*\\s*개/i.test(pageText);\n      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);\n      const confirmed = allProducts.length > 0 || trustedChannelEvidence;`,
  `      // 공통 카드 판정 엔진: 먼저 실제 상품 카드 블록을 찾고, 그 카드 안의 판매처 유형만 판정한다.\n      // 네이버/SSG/롯데ON이 같은 Node 판정기를 사용하고 사이트별 인정 라벨만 설정으로 다르다.\n      let cardVerdict = { trusted: false, labels: [], verdict: "absent" };\n      for (let attempt = 0; attempt < 10 && !cardVerdict.trusted; attempt += 1) {\n        const renderedCards = await searchWindow.webContents.executeJavaScript(\n          \`(() => {\n            const queryCode = \${JSON.stringify(String(articleNumber || \"\").trim().toUpperCase())};\n            const candidates = [];\n            const seen = new Set();\n            for (const node of document.querySelectorAll(\"a, li, article, div, section\")) {\n              const text = String(node.innerText || node.textContent || \"\").replace(/\\s+/g, \" \" ).trim();\n              if (!text || text.length < 8 || text.length > 3000) continue;\n              const hasImage = Boolean(node.querySelector?.(\"img\"));\n              const hasPrice = /\\d{1,3}(?:,\\d{3})+\\s*원/.test(text);\n              const hasCode = !queryCode || text.toUpperCase().includes(queryCode);\n              if (!hasImage || !hasPrice || !hasCode) continue;\n              const key = text.slice(0, 500);\n              if (seen.has(key)) continue;\n              seen.add(key);\n              candidates.push({ text, markup: String(node.outerHTML || \"\").slice(0, 12000) });\n            }\n            return candidates.slice(0, 80);\n          })()\`,\n          true,\n        ).catch(() => []);\n        cardVerdict = evaluateDomesticProductCards({\n          store: "네이버 패션타운",\n          articleNumber,\n          cards: renderedCards,\n        });\n        if (!cardVerdict.trusted) await new Promise((resolve) => setTimeout(resolve, 500));\n      }\n      const trustedChannelLabels = cardVerdict.labels;\n      const trustedChannelEvidence = cardVerdict.trusted === true;\n      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);\n      const confirmed = trustedChannelEvidence;`,
  "use shared exact product-card verdict engine for Naver");

main = replaceOnce(main,
  `        absenceConfirmed: explicitEmpty && !trustedChannelEvidence,`,
  `        absenceConfirmed: !trustedChannelEvidence,`,
  "Naver label absence means product absent");
main = replaceOnce(main,
  `        naverTrustedChannelEvidence: trustedChannelEvidence,\n        naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending"),`,
  `        naverTrustedChannelEvidence: trustedChannelEvidence,\n        naverTrustedChannelLabels: trustedChannelLabels,\n        naverAllSearchVerdict: confirmed ? "confirmed" : "absent",`,
  "Naver verdict is strictly binary from seller labels");
// A visible exact product-code card is positive evidence even if Naver changes
// or delays the seller-label text. Only an explicit empty-result page is absent.
main = main.replace(
  "      const confirmed = trustedChannelEvidence;",
  "      const confirmed = allProducts.length > 0 || trustedChannelEvidence;",
);
main = main.replace(
  "        absenceConfirmed: !trustedChannelEvidence,",
  "        absenceConfirmed: explicitEmpty && !confirmed,",
);
main = main.replace(
  '        naverAllSearchVerdict: confirmed ? "confirmed" : "absent",',
  '        naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending"),',
);
// Preserve the actual Naver result card as a renderer product. Previously the
// shared verdict engine kept only its seller-label evidence, so the UI could
// say "confirmed" while showing no image, title, price, or purchase link.
main = main.replace(
  '      let cardVerdict = { trusted: false, labels: [], verdict: "absent" };',
  '      let renderedProductCards = [];\n      let naverVisibleResultCount = 0;\n      let naverVisibleResultCountObserved = false;\n      let cardVerdict = { trusted: false, labels: [], verdict: "absent" };',
);
main = main.replace(
  '      for (let attempt = 0; attempt < 10 && !cardVerdict.trusted; attempt += 1) {',
  '      // Naver renders the visible total before its lazy product cards. Do not\n      // finish with zero while the page itself says products exist.\n      for (let attempt = 0; attempt < 60 && renderedProductCards.length < Math.max(1, naverVisibleResultCount); attempt += 1) {',
);
main = main.replace(
  '              candidates.push({ text, markup: String(node.outerHTML || "").slice(0, 12000) });',
  `              const anchor = node.matches?.("a[href]") ? node : node.querySelector?.("a[href]");
              const image = node.querySelector?.("img");
              const productUrl = String(anchor?.href || "").split("#")[0];
              const imageUrl = String(image?.currentSrc || image?.dataset?.original || image?.dataset?.src || image?.src || "");
              const title = String(image?.alt || anchor?.getAttribute?.("aria-label") || node.querySelector?.("[class*='title'],[class*='name'],strong")?.textContent || text.split("\\n")[0] || "").trim();
              const price = text.match(/\\d{1,3}(?:,\\d{3})+\\s*원/)?.[0] || "";
              candidates.push({ text, markup: String(node.outerHTML || "").slice(0, 12000), productUrl, imageUrl, title, price });`,
);
main = main.replace(
  '            const candidates = [];\n            const seen = new Set();',
  `            const candidates = [];
            const seen = new Set();
            const compactCode = (value) => String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
            const exactQueryPage = compactCode(new URLSearchParams(location.search).get("q")) === compactCode(queryCode);
            const bodyText = String(document.body?.innerText || "").replace(/\\s+/g, " ");
            const totalMatch = bodyText.match(/(?:^|\\s)전체\\s*([0-9,]+)\\s*개/);
            const visibleResultCount = Number(String(totalMatch?.[1] || "0").replace(/,/g, "")) || 0;
            const isProductHref = (href) => {
              try {
                const parsed = new URL(String(href || ""), location.href);
                if (!/\\.naver\\.com$/i.test(parsed.hostname)) return false;
                if (/\\/window\\/search(?:\\/|$)/i.test(parsed.pathname)) return false;
                return /\\/(?:window-products?|products?|catalog|product)\\//i.test(parsed.pathname)
                  || /(?:product|nvMid|item|mallProductId|channelProductNo)=/i.test(parsed.search);
              } catch { return false; }
            };
            // Copy Naver's rendered list directly. The product URL is identity;
            // title, image and price come from the nearest rendered card.
            if (exactQueryPage) {
              for (const anchor of document.querySelectorAll("a[href]")) {
                const productUrl = String(anchor.href || "").split("#")[0];
                if (seen.has(productUrl)) continue;
                // Naver renders the image link, title and prices as sibling
                // blocks under hashed class names. Walk upward and select the
                // smallest ancestor that owns the visible code and price.
                let card = anchor;
                for (let depth = 0, node = anchor; node && depth < 9; depth += 1, node = node.parentElement) {
                  const candidateText = String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
                  if (compactCode(candidateText).includes(compactCode(queryCode))
                    && /\\d{1,3}(?:,\\d{3})+\\s*원/.test(candidateText)
                    && node.querySelector?.("img")) {
                    card = node;
                    break;
                  }
                }
                const image = anchor.querySelector?.("img") || card.querySelector?.("img");
                if (!image) continue;
                const text = String(card.innerText || card.textContent || anchor.innerText || "").replace(/\\s+/g, " ").trim();
                if (!isProductHref(productUrl) && !compactCode(text).includes(compactCode(queryCode))) continue;
                const imageUrl = String(image.currentSrc || image.dataset?.original || image.dataset?.src || image.src || "");
                const title = String(image.alt || anchor.getAttribute?.("aria-label") || card.querySelector?.("[class*='title'],[class*='name'],strong")?.textContent || text || "네이버 패션타운 검색 결과").trim();
                const prices = [...text.matchAll(/\\d{1,3}(?:,\\d{3})+\\s*원/g)].map((match) => match[0]);
                const originalPrice = prices.length > 1 ? prices[0] : "";
                const price = prices.at(-1) || "";
                seen.add(productUrl);
                candidates.push({ text, markup: String(card.outerHTML || "").slice(0, 12000), productUrl, imageUrl, title, price, originalPrice });
              }
            }`,
);
main = main.replace(
  '              const hasCode = !queryCode || text.toUpperCase().includes(queryCode);',
  '              const hasCode = !queryCode || text.toUpperCase().includes(queryCode);\n              const candidateAnchor = node.matches?.("a[href]") ? node : Array.from(node.querySelectorAll?.("a[href]") || []).find((link) => isProductHref(link.href));\n              const productLink = isProductHref(candidateAnchor?.href);',
);
main = main.replace(
  '              if (!hasImage || !hasPrice || !hasCode) continue;',
  '              // On an exact-query page Naver may split image, title and price across siblings.\n              // A real product link plus image is sufficient; price may arrive later.\n              if (!hasImage || ((!hasPrice || !hasCode) && !(exactQueryPage && productLink))) continue;',
);
main = main.replace(
  '              const anchor = node.matches?.("a[href]") ? node : node.querySelector?.("a[href]");',
  '              const anchor = candidateAnchor || (node.matches?.("a[href]") ? node : node.querySelector?.("a[href]"));',
);
main = main.replace(
  '            return candidates.slice(0, 80);',
  '            return { cards: candidates.slice(0, 80), visibleResultCount, visibleResultCountObserved: Boolean(totalMatch) };',
);
main = main.replace(
  '        const renderedCards = await searchWindow.webContents.executeJavaScript(',
  '        const renderedResult = await searchWindow.webContents.executeJavaScript(',
);
main = main.replace(
  '        cardVerdict = evaluateDomesticProductCards({\n          store: "네이버 패션타운",',
  '        const renderedCards = Array.isArray(renderedResult) ? renderedResult : (Array.isArray(renderedResult?.cards) ? renderedResult.cards : []);\n        naverVisibleResultCount = Math.max(naverVisibleResultCount, Number(renderedResult?.visibleResultCount || 0));\n        naverVisibleResultCountObserved = naverVisibleResultCountObserved || renderedResult?.visibleResultCountObserved === true;\n        cardVerdict = evaluateDomesticProductCards({\n          store: "네이버 패션타운",',
);
main = main.replace(
  '        cardVerdict = evaluateDomesticProductCards({\n          store: "네이버 패션타운",',
  '        renderedProductCards = renderedCards;\n        cardVerdict = evaluateDomesticProductCards({\n          store: "네이버 패션타운",',
);
main = main.replace(
  '      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);',
  `      // The rendered product list itself is the verdict, matching Musinsa.
      // Intermediate wording is not used: cards are listed, otherwise absent.
      const analyzedProducts = Array.isArray(analyzed.products) ? analyzed.products : [];
      const cardProducts = renderedProductCards
        .filter((card) => /^https?:\\/\\//i.test(String(card?.productUrl || "")))
        .filter((card, index, all) => index === all.findIndex((candidate) => String(candidate?.productUrl || "") === String(card?.productUrl || "")))
        .slice(0, 8)
        .map((card, index) => ({
          store: "네이버 패션타운",
          sourceStore: "네이버 패션타운",
          retailerName: "네이버 패션타운",
          id: String(card.productUrl || \`naver-fashion-\${index}\`),
          url: String(card.productUrl || resolvedSearchUrl),
          title: String(card.title || card.text || "네이버 패션타운 검색 결과").trim().slice(0, 240),
          articleNumber,
          imageUrl: String(card.imageUrl || ""),
          imageVerifiedFromCard: Boolean(card.imageUrl),
          price: Number(String(card.price || "").replace(/[^0-9]/g, "")) || 0,
          originalPrice: Number(String(card.originalPrice || "").replace(/[^0-9]/g, "")) || 0,
          inStock: null,
          sizes: [],
          confidence: 90,
          signals: { code: "검색어 일치", title: "패션타운 결과", image: card.imageUrl ? "확인" : "없음" },
        }));
      // Naver's rendered list is authoritative. The analyzer is only a fallback
      // until Naver exposes its product anchors.
      const allProducts = cardProducts.length ? cardProducts : analyzedProducts;
      const naverExplicitlyEmpty = naverVisibleResultCountObserved
        && naverVisibleResultCount === 0
        && allProducts.length === 0;`,
);
main = main.replace(
  '      const confirmed = allProducts.length > 0 || trustedChannelEvidence;',
  '      const confirmed = allProducts.length > 0;',
);
main = main.replace(
  '        absenceConfirmed: explicitEmpty && !confirmed,',
  '        absenceConfirmed: naverExplicitlyEmpty && !confirmed,',
);
main = main.replace(
  '        naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending"),',
  '        naverAllSearchVerdict: confirmed ? "confirmed" : (naverExplicitlyEmpty ? "absent" : "pending"),',
);
main = main.replace(
  '        count: allProducts.length,\n        products: allProducts,',
  '        count: Math.max(naverVisibleResultCount, allProducts.length),\n        products: allProducts,',
);
main = main.replace(
  '        candidateCount: allProducts.length,',
  '        candidateCount: Math.max(naverVisibleResultCount, allProducts.length),',
);

main = replaceOnce(main,
  `        candidateCount: Number(result?.candidateCount || 0),\n      // The official search URL and a verified product-detail URL are`,
  `        candidateCount: Number(result?.candidateCount || 0),\n        naverChannelCounts: result?.naverChannelCounts || null,\n        naverTrustedChannelEvidence: result?.naverTrustedChannelEvidence === true,\n        naverTrustedChannelLabels: Array.isArray(result?.naverTrustedChannelLabels) ? result.naverTrustedChannelLabels : [],\n        naverAllSearchVerdict: result?.naverAllSearchVerdict || null,\n      // The official search URL and a verified product-detail URL are`,
  "preserve Naver label-only verdict in source result");
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(renderer,
  `    if (String(source.store || "") === "네이버 패션타운") {\n      if (source.presenceConfirmed || source.naverTrustedChannelEvidence || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length) return { label: "확인완료", className: "available" };\n      if (source.absenceConfirmed || source.naverAllSearchVerdict === "absent") return { label: "상품없음", className: "missing" };\n    }`,
  `    if (String(source.store || "") === "네이버 패션타운") {\n      if (source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed") return { label: "확인완료", className: "available" };\n      return { label: "상품없음", className: "missing" };\n    }`,
  "Naver status depends only on seller-type labels");
renderer = replaceOnce(renderer,
  `    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "상세 확인 필요", className: "pending" };`,
  `    const naverFashionTownConfirmed = String(source.store || "") === "네이버 패션타운"\n      && (source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed");\n    if (naverFashionTownConfirmed) return { label: "확인완료", className: "available" };\n    if (String(source.store || "") === "네이버 패션타운") return { label: "상품없음", className: "missing" };\n    const officialMallSource = String(source.store || "") === "브랜드 공식몰";\n    if (officialMallSource) {\n      const officialResultFound = source.presenceConfirmed === true\n        || matchedProducts.length > 0\n        || (source.searchCompleted === true && Number(source.count || 0) > 0);\n      const officialResultMissing = source.absenceConfirmed === true\n        || (source.searchCompleted === true && Number(source.count || 0) === 0 && Number(source.candidateCount || 0) === 0);\n      if (officialResultFound) return { label: "확인완료", className: "available" };\n      if (officialResultMissing) return { label: "상품없음", className: "missing" };\n    }\n    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "정확 상품 추가 확인", className: "pending" };`,
  "show label-only Naver and official mall verdict before pending state");
renderer = replaceOnce(renderer,
  `    const detailPending = source.verificationReason\n      ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n      : !matchedProducts.length && Number(source.count || 0) > 0\n        ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 재고·사이즈 상세 수집이 필요합니다.\`\n        : source.absenceConfirmed\n          ? "상품코드→상품명→상품명+상품코드 순서로 검색을 완료했으며 일치 상품이 없습니다."\n          : Number(source.candidateCount || 0) > 0\n            ? "일치 후보 상품을 찾았지만 상세 페이지의 재고·사이즈 확인이 완료되지 않았습니다."\n            : !matchedProducts.length ? "검색은 완료했지만 재고·사이즈 판정 근거가 부족합니다." : "";`,
  `    const naverFashionTownSource = String(source.store || "") === "네이버 패션타운";\n    const naverFashionTownConfirmed = naverFashionTownSource\n      && (source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed");\n    const officialMallSource = String(source.store || "") === "브랜드 공식몰";\n    const officialResultFound = officialMallSource && (source.presenceConfirmed === true || matchedProducts.length > 0 || (source.searchCompleted === true && Number(source.count || 0) > 0));\n    const officialResultMissing = officialMallSource && (source.absenceConfirmed === true || (source.searchCompleted === true && Number(source.count || 0) === 0 && Number(source.candidateCount || 0) === 0));\n    const detailPending = naverFashionTownConfirmed\n      ? "정확 상품 카드에서 브랜드직영몰·백화점·아울렛 판매처 유형을 확인하여 정품 유통 근거가 충분합니다."\n      : naverFashionTownSource\n        ? "정확 상품 카드에서 인정 판매처 유형이 확인되지 않아 상품없음으로 판정했습니다."\n        : officialResultFound\n          ? "브랜드 공식몰 검색 결과에서 상품을 확인했습니다."\n          : officialResultMissing\n            ? "브랜드 공식몰 검색 결과에 상품이 없습니다."\n            : source.verificationReason\n              ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n              : !matchedProducts.length && Number(source.count || 0) > 0\n                ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 정확 상품 일치 여부를 추가 확인합니다.\`\n                : source.absenceConfirmed\n                  ? "상품코드 중심 검색을 완료했으며 일치 상품이 없습니다."\n                  : Number(source.candidateCount || 0) > 0\n                    ? "일치 후보 상품을 찾았지만 정확 상품 확인이 완료되지 않았습니다."\n                    : !matchedProducts.length ? "검색은 완료했지만 정확 상품 판정 근거가 부족합니다." : "";`,
  "show shared exact-card Naver verdict wording");
renderer = renderer.replaceAll(
  'source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed"',
  'source.presenceConfirmed === true || source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length > 0 || Number(source.count || 0) > 0',
);
renderer = renderer.replace(
  '      return { label: "상품없음", className: "missing" };',
  '      return { label: "상품없음", className: "missing" };',
);
renderer = renderer.replace(
  '    if (String(source.store || "") === "네이버 패션타운") return { label: "상품없음", className: "missing" };',
  '    if (String(source.store || "") === "네이버 패션타운" && (source.absenceConfirmed === true || source.naverAllSearchVerdict === "absent")) return { label: "상품없음", className: "missing" };',
);
renderer = renderer.replace(
  '? "정확 상품 카드에서 인정 판매처 유형이 확인되지 않아 상품없음으로 판정했습니다."',
  '? (source.absenceConfirmed === true || source.naverAllSearchVerdict === "absent" ? "패션타운 검색 결과에 일치 상품이 없습니다." : "패션타운 검색 결과를 확인하고 있습니다.")',
);
renderer = renderer.replaceAll("검색·재고 확인", "검색 결과 열기");
renderer = renderer.replaceAll("검색 입력 실패", "검색 결과 확인");
renderer = renderer.replaceAll("상품코드를 검색창에 입력하고 검색 버튼을 누르는 단계에서 중단됐습니다.", "검색 결과 화면을 확인하고 있습니다.");
// All domestic sites use the same simple result-list contract as Musinsa:
// collected product cards are rendered; an empty card list is 상품 없음.
renderer = renderer.replace(
  /function domesticStatus\(result\) \{[\s\S]*?\n\}\n\nfunction hasDomesticStock/,
  `function domesticStatus(result) {
  if (!result) return { label: "확인 전", className: "pending" };
  if (result.loading) return { label: "검색 중", className: "loading" };
  const products = Array.isArray(result.products) ? result.products : [];
  if (!products.length) return { label: "상품 없음", className: "missing" };
  return { label: \`상품 \${products.length}개\`, className: "available" };
}

function hasDomesticStock`,
);
renderer = renderer.replace(
  /  const sourceStatus = \(source, matchedProducts\) => \{[\s\S]*?\n  \};\n  const renderedProductKeys/,
  `  const sourceStatus = (_source, matchedProducts) => matchedProducts.length
    ? { label: \`상품 \${matchedProducts.length}개\`, className: "available" }
    : { label: "상품 없음", className: "missing" };
  const renderedProductKeys`,
);
renderer = renderer.replace(
  /    const failureDescriptions = \{[\s\S]*?\n    return `<section/,
  '    const detailPending = matchedProducts.length ? "" : "상품 없음";\n    return `<section',
);
await writeFile(rendererPath, renderer, "utf8");
console.log("Naver, SSG, and Lotte use one exact product-card verdict engine with site-specific trusted labels");
