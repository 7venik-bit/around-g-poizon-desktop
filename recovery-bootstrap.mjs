import { app } from "electron";

const naverProductClickState = new Map();

function cleanUrl(value) {
  return String(value || "").split("#")[0];
}

function productKey(value) {
  const raw = cleanUrl(value);
  try {
    const url = new URL(raw);
    const stableParams = ["productId", "nvMid", "itemId", "goodsNo"]
      .map((name) => [name, url.searchParams.get(name)])
      .filter(([, value]) => value);
    if (stableParams.length) {
      return `${url.origin}${url.pathname}?${stableParams.map(([name, value]) => `${name}=${value}`).join("&")}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
}

function expectedUrlFromScript(source) {
  const match = String(source || "").match(/const expected = ("(?:\\.|[^"\\])*");/);
  if (!match) return "";
  try { return JSON.parse(match[1]); } catch { return ""; }
}

function installNaverProductClickGuard(window) {
  const contents = window?.webContents;
  if (!contents || contents.__aroundGNaverClickGuardInstalled) return;
  contents.__aroundGNaverClickGuardInstalled = true;

  const nativeExecuteJavaScript = contents.executeJavaScript.bind(contents);
  contents.executeJavaScript = async (code, userGesture) => {
    const source = String(code || "");
    const isRenderedProductCardLookup =
      source.includes('const links = [...document.querySelectorAll("a[href]")]')
      && source.includes('left.origin === right.origin && left.pathname === right.pathname')
      && source.includes('const expected = ');

    if (!isRenderedProductCardLookup) {
      return nativeExecuteJavaScript(code, userGesture);
    }

    const expectedUrl = expectedUrlFromScript(source);
    const key = productKey(expectedUrl);
    const isScrollLookup = source.includes('link.scrollIntoView({ block: "center", inline: "center" });');
    const isPointLookup = source.includes('Math.min(rect.height / 2, 180)');
    const state = naverProductClickState.get(key) || "new";

    // Once a rendered Naver product card has already been handled, never
    // revisit the same product from the three Fashion Town channel passes.
    if (key && state === "done") {
      return isScrollLookup ? false : isPointLookup ? null : nativeExecuteJavaScript(code, userGesture);
    }

    const originalResult = await nativeExecuteJavaScript(code, userGesture).catch(() => null);
    if (originalResult) {
      if (key && isScrollLookup) naverProductClickState.set(key, "pending");
      if (key && isPointLookup) naverProductClickState.set(key, "done");
      return originalResult;
    }

    if (!isScrollLookup && !isPointLookup) return originalResult;

    const fallbackScript = `(() => {
      const expected = ${JSON.stringify(expectedUrl)};
      const clean = (value) => String(value || "").split("#")[0];
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0
          && rect.width >= 40
          && rect.height >= 30
          && rect.bottom > 60
          && rect.top < innerHeight
          && rect.right > 0
          && rect.left < innerWidth;
      };
      const productPattern = /window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
      let expectedParsed = null;
      try { expectedParsed = new URL(expected); } catch {}
      const expectedIds = expectedParsed
        ? ["productId", "nvMid", "itemId", "goodsNo"].map((name) => expectedParsed.searchParams.get(name)).filter(Boolean)
        : [];

      const candidates = [...document.querySelectorAll("a[href]")].map((anchor) => {
        const card = anchor.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]") || anchor.parentElement || anchor;
        const image = anchor.querySelector("img,picture img") || card.querySelector?.("img,picture img");
        const rect = anchor.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const imageRect = image?.getBoundingClientRect?.() || { width: 0, height: 0 };
        const href = clean(anchor.href);
        let score = 0;
        if (href === clean(expected)) score += 10000;
        try {
          const left = new URL(href);
          if (expectedParsed && left.origin === expectedParsed.origin && left.pathname === expectedParsed.pathname) score += 7000;
          if (expectedIds.some((id) => href.includes(id))) score += 6000;
        } catch {}
        if (productPattern.test(href)) score += 1500;
        if (image && imageRect.width >= 70 && imageRect.height >= 70) score += 1000;
        if (cardRect.width >= 120 && cardRect.height >= 100) score += 500;
        if (visible(anchor) || visible(card)) score += 300;
        return { anchor, card, image, rect, cardRect, imageRect, href, score };
      }).filter((item) => item.score >= 1800)
        .sort((a, b) => b.score - a.score || a.cardRect.top - b.cardRect.top || a.cardRect.left - b.cardRect.left);

      const selected = candidates[0];
      if (!selected) return ${isScrollLookup ? "false" : "null"};
      selected.card.scrollIntoView({ block: "center", inline: "center" });
      if (${isScrollLookup ? "true" : "false"}) return true;

      const cardRect = selected.card.getBoundingClientRect();
      const imageRect = selected.image?.getBoundingClientRect?.();
      const clickRect = imageRect && imageRect.width >= 50 && imageRect.height >= 50 ? imageRect
        : cardRect.width > 0 && cardRect.height > 0 ? cardRect
        : selected.anchor.getBoundingClientRect();
      if (clickRect.width <= 0 || clickRect.height <= 0) return null;
      return {
        x: Math.round(clickRect.left + clickRect.width / 2),
        y: Math.round(clickRect.top + Math.min(clickRect.height / 2, 180)),
        physicalFallback: true,
      };
    })()`;

    const fallbackResult = await nativeExecuteJavaScript(fallbackScript, true).catch(() => null);
    if (fallbackResult) {
      if (key && isScrollLookup) naverProductClickState.set(key, "pending");
      if (key && isPointLookup) naverProductClickState.set(key, "done");
    }
    return fallbackResult;
  };
}

app.on("browser-window-created", (_event, window) => {
  installNaverProductClickGuard(window);
});

await import("./bootstrap.mjs");
