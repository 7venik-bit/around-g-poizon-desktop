import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let main = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");
let relay = String(await readFile(relayPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "NAVER_SINGLE_OVERVIEW_SEARCH_V1";
if (main.includes(marker) && relay.includes(marker)) {
  console.log("single Naver overview search already applied");
  process.exit(0);
}

const naverSourceAnchor = '  const naverPortalSource = /^네이버\\s/.test(String(source.store || ""));';
if (!main.includes(naverSourceAnchor)) throw new Error("Naver source anchor missing");
main = main.replace(
  naverSourceAnchor,
  `${naverSourceAnchor}\n  // ${marker}: one Fashion Town overview search is captured once, then each card is classified locally.`,
);

const threeNaverSources = `    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },
    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },
    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },`;
if (!relay.includes(threeNaverSources)) throw new Error("three-row Naver source block missing");
relay = relay.replace(
  threeNaverSources,
  `    // One overview request already includes official malls, department stores and outlets.
    { store: "네이버 패션타운", linkOnly: true, fashionTown: "overview", renderCount: true },`,
);

const legacyChannelClickFlag = `    const naverChannelClickRequired = [
      "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛",
    ].includes(String(source.store || ""));`;
if (!main.includes(legacyChannelClickFlag)) throw new Error("legacy Naver channel-click flag missing");
main = main.replace(
  legacyChannelClickFlag,
  `    // The overview page already contains brand-store, department and outlet results.\n    // Never click those channel tabs after the product query has been submitted.\n    const naverChannelClickRequired = false;`,
);

const legacyReuseBlock = `    if (reuseNaverSearch) {
      searchWindow = sharedNaverSession.window;
      naverChannelCounts = sharedNaverSession.channelCounts;
      await Promise.race([
        searchWindow.loadURL(sharedNaverSession.resultsUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error("NAVER_RESULTS_RELOAD_TIMEOUT")), 20_000)),
      ]).catch(() => {});
      await wait(1_200);
    } else {`;
if (!main.includes(legacyReuseBlock)) throw new Error("legacy Naver result reload block missing");
main = main.replace(
  legacyReuseBlock,
  `    if (reuseNaverSearch) {
      // Reuse the exact DOM produced by the first query. Reloading the result URL
      // caused Naver to render/transition again and made one user search look like
      // several searches even though the query text was not retyped.
      searchWindow = sharedNaverSession.window;
      naverChannelCounts = sharedNaverSession.channelCounts;
      await wait(250);
    } else {`,
);

const countBlockStart = main.indexOf(`    if (naverPortalSource) {
      // The three Fashion Town totals are the authoritative routing decision.`);
const countBlockEnd = main.indexOf("    if (naverChannelClickRequired) {", countBlockStart);
if (countBlockStart < 0 || countBlockEnd < 0) throw new Error("Naver count-routing block missing");
const overviewCountBlock = `    if (naverPortalSource) {
      // Counts are useful metadata, but they are no longer a prerequisite for
      // reading the overview result. Naver can change or delay tab-count markup
      // while the actual product cards are already visible and usable.
      naverChannelCounts ||= await readNaverFashionTownChannelCounts(searchWindow) || {};
      if (sharedNaverSession && !reuseNaverSearch) {
        sharedNaverSession.window = searchWindow;
        sharedNaverSession.resultsUrl = String(searchWindow.webContents.getURL() || url);
        sharedNaverSession.channelCounts = naverChannelCounts;
        sharedNaverSession.searchSubmitted = true;
      }
      const currentChannelRaw = naverChannelCounts[String(source.store || "")];
      const currentChannelCount = Number.isFinite(Number(currentChannelRaw)) ? Number(currentChannelRaw) : null;
      if (currentChannelCount === 0) {
        return {
          count: 0,
          channelCount: 0,
          products: [],
          presenceConfirmed: false,
          absenceConfirmed: true,
          searchCompleted: true,
          searchSubmitted: true,
          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
          naverChannelCounts,
        };
      }
    }
`;
main = `${main.slice(0, countBlockStart)}${overviewCountBlock}${main.slice(countBlockEnd)}`;

const legacyCardPush = `        seen.add(productKey);
        const channelEvidenceText = [text, markup].join(" ");
        const officialBrandStoreLabelMatched = /브랜드\\s*직영몰|공식\\s*브랜드|브랜드\\s*스토어/i.test(channelEvidenceText);
        const departmentStoreLabelMatched = /백화점/i.test(channelEvidenceText);
        const outletLabelMatched = /아울렛|outlet/i.test(channelEvidenceText);
        productCards.push({
          productUrl, text, markup, imageUrl, imageLinkedToProduct, title, price, originalPrice,
          officialBrandStoreLabelMatched, departmentStoreLabelMatched, outletLabelMatched,
        });`;
if (!main.includes(legacyCardPush)) throw new Error("rendered product-card capture block missing");
main = main.replace(
  legacyCardPush,
  `        seen.add(productKey);
        const channelEvidenceText = [text, markup].join(" ");
        const officialBrandStoreLabelMatched = /브랜드\\s*직영몰|공식\\s*브랜드|브랜드\\s*스토어/i.test(channelEvidenceText);
        const departmentStoreLabelMatched = /백화점/i.test(channelEvidenceText);
        const outletLabelMatched = /아울렛|outlet/i.test(channelEvidenceText);
        let naverWholeViewChannel = "";
        try {
          const productHost = new URL(productUrl).hostname.toLowerCase();
          if (productHost === "naver.com" || productHost.endsWith(".naver.com")) {
            naverWholeViewChannel = /\\/window-products\\/department\\//i.test(productUrl) || departmentStoreLabelMatched
              ? "department"
              : /\\/window-products\\/outlet\\//i.test(productUrl) || outletLabelMatched
                ? "outlet"
                : "brand-store";
          }
        } catch {}
        productCards.push({
          productUrl, text, markup, imageUrl, imageLinkedToProduct, title, price, originalPrice,
          officialBrandStoreLabelMatched, departmentStoreLabelMatched, outletLabelMatched,
          naverWholeViewChannel,
        });`,
);

const naverFilterStart = main.indexOf('    if (naverPortalSource && Number(naverChannelCounts?.[String(source.store || "")]) > 0) {');
const naverFilterEnd = main.indexOf('    if (["SSG 백화점", "SSG 아울렛"].includes(String(source.store || ""))) {', naverFilterStart);
if (naverFilterStart < 0 || naverFilterEnd < 0) throw new Error("legacy Naver per-channel result filter missing");
const overviewFilterBlock = `    if (naverPortalSource) {
      const expectedNaverChannel = source.store === "네이버 백화점" ? "department"
        : source.store === "네이버 아울렛" ? "outlet"
          : source.store === "네이버 공식 브랜드스토어" ? "brand-store" : "";
      const currentChannelRaw = naverChannelCounts?.[String(source.store || "")];
      const currentChannelCount = Number.isFinite(Number(currentChannelRaw)) ? Number(currentChannelRaw) : null;
      const channelCards = (parsedContent.productCards || []).filter((card) =>
        isPlatformShoppingProductUrl(card?.productUrl)
          && (!expectedNaverChannel || String(card?.naverWholeViewChannel || "") === expectedNaverChannel));
      if (!channelCards.length && Number(currentChannelCount || 0) > 0) {
        return renderedSearchFailure("overview_channel_card_collection_failed", searchWindow, {
          searchSubmitted: true,
          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
        });
      }
      parsedContent.productCards = channelCards;
      parsedContent.selectedChannelCount = currentChannelCount ?? channelCards.length;
      content = JSON.stringify(parsedContent);
    }
`;
main = `${main.slice(0, naverFilterStart)}${overviewFilterBlock}${main.slice(naverFilterEnd)}`;

const legacySharedClose = `    if (source.store === "네이버 아울렛"
      && sharedNaverSession.window
      && !sharedNaverSession.window.isDestroyed()) {`;
if (!main.includes(legacySharedClose)) throw new Error("legacy shared Naver close target missing");
main = main.replace(
  legacySharedClose,
  `    if (source.store === "네이버 패션타운"
      && sharedNaverSession.window
      && !sharedNaverSession.window.isDestroyed()) {`,
);

const relayMarkerAnchor = '      const matchingProducts = new Map();';
if (!relay.includes(relayMarkerAnchor)) throw new Error("relay matching-products anchor missing");
relay = relay.replace(
  relayMarkerAnchor,
  `      // ${marker}: cards were classified from one Naver overview page before matching.\n${relayMarkerAnchor}`,
);

const naverLegacyStart = relay.indexOf(`        // Naver Fashion Town can append recommendations from another channel
        // below an empty selected result. Never count those cards as the
        // official-store, department-store, or outlet result being checked.
        const naverStore = String(store || "");`);
const naverLegacyEnd = relay.indexOf('        if (naverStore === "SSG 백화점"', naverLegacyStart);
if (naverLegacyStart < 0 || naverLegacyEnd < 0) throw new Error("relay legacy Naver channel gate missing");
const naverOverviewGate = `        // One Naver overview page is classified before matching. Trust that
        // local classification when present; retain the legacy label/URL checks
        // only for old/non-overview captures.
        const naverStore = String(store || "");
        const overviewChannel = String(card?.naverWholeViewChannel || "");
        const expectedOverviewChannel = naverStore === "네이버 백화점" ? "department"
          : naverStore === "네이버 아울렛" ? "outlet"
            : naverStore === "네이버 공식 브랜드스토어" ? "brand-store" : "";
        if (expectedOverviewChannel && overviewChannel && overviewChannel !== expectedOverviewChannel) continue;
        if (expectedOverviewChannel && !overviewChannel) {
          if (naverStore === "네이버 아울렛" && /\\/window-products\\/department\\//i.test(productUrl)) continue;
          if (naverStore === "네이버 백화점" && /\\/window-products\\/outlet\\//i.test(productUrl)) continue;
          if (naverStore === "네이버 공식 브랜드스토어"
            && /\\/window-products\\/(?:outlet|department)\\//i.test(productUrl)) continue;
          if (naverStore === "네이버 공식 브랜드스토어"
            && card?.officialBrandStoreLabelMatched !== true
            && !/브랜드\\s*직영몰|공식\\s*브랜드|브랜드\\s*스토어/i.test(\`${'${rawCardText}'} ${'${String(card?.markup || "")}'}\`)) continue;
          if (naverStore === "네이버 백화점"
            && card?.departmentStoreLabelMatched !== true
            && !/백화점/i.test(\`${'${rawCardText}'} ${'${String(card?.markup || "")}'}\`)) continue;
          if (naverStore === "네이버 아울렛"
            && card?.outletLabelMatched !== true
            && !/아울렛|outlet/i.test(\`${'${rawCardText}'} ${'${String(card?.markup || "")}'}\`)) continue;
        }
`;
relay = `${relay.slice(0, naverLegacyStart)}${naverOverviewGate}${relay.slice(naverLegacyEnd)}`;

const conservativeNaverFallback = `        if (!conflictingArticle && !articleMatched && /^네이버\\s/.test(String(store || "")) && cards.length === 1
          && brandMatched && titleIdentityMatch(rawCardText, expectedTitle)) {
          articleMatched = true;
        }`;
if (!relay.includes(conservativeNaverFallback)) throw new Error("legacy single-card Naver title fallback missing");
relay = relay.replace(
  conservativeNaverFallback,
  `        // Naver may omit the manufacturer code from a card. In the overview
        // flow the channel has already been isolated, so a real platform card
        // with matching brand + strong title and no conflicting manufacturer
        // code is valid even when multiple products are shown in that channel.
        if (!conflictingArticle && !articleMatched && /^네이버\\s/.test(String(store || ""))
          && brandMatched && titleIdentityMatch(rawCardText, expectedTitle)
          && isPlatformShoppingProductUrl(productUrl)) {
          articleMatched = true;
        }`,
);

await writeFile(mainPath, main, "utf8");
await writeFile(relayPath, relay, "utf8");
console.log("Naver now uses one overview search, local channel classification, and stable card matching");
