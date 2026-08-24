import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(targetPath, "utf8");

const marker = 'async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = "") {';
const start = source.indexOf(marker);
if (start < 0) throw new Error("clickRenderedProductCard function not found");

const nextCandidates = [
  source.indexOf("\nasync function ", start + marker.length),
  source.indexOf("\nfunction ", start + marker.length),
].filter((index) => index > start);
if (!nextCandidates.length) throw new Error("next top-level function after clickRenderedProductCard not found");
const end = Math.min(...nextCandidates);

// Remove an older guard declaration immediately before the function so this
// build always installs exactly one authoritative click-state owner.
let prefix = source.slice(0, start);
prefix = prefix.replace(/const naverProductClickAttempts = new Set\(\);\s*$/m, "");

const replacement = `const naverProductClickAttempts = new Set();

async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = "") {
  const expectedUrl = String(productUrl || "").split("#")[0];
  if (!/^https?:\\/\\//i.test(expectedUrl)) return false;
  if (!searchWindow || searchWindow.isDestroyed()) return false;

  const stableProductIdentity = (value) => {
    try {
      const parsed = new URL(String(value || ""));
      for (const key of ["productId", "nvMid", "itemId", "goodsNo"]) {
        const found = parsed.searchParams.get(key);
        if (found) return key + ":" + found;
      }
      const segments = parsed.pathname.split("/").filter(Boolean);
      const last = segments.at(-1) || "";
      return parsed.origin + ":" + last;
    } catch {
      return String(value || "").split("#")[0];
    }
  };

  const clickAttemptKey = stableProductIdentity(expectedUrl);

  // A product that already reached the click stage is DONE for this search.
  // Returning false here used to send the caller back into the same search.
  if (naverProductClickAttempts.has(clickAttemptKey)) return true;

  const currentUrl = String(searchWindow.webContents.getURL() || "");
  const resultsUrl = String(searchResultsUrl || "");
  // Never reload Naver search results during card verification. SPA tracking
  // hrefs change after reload and previously caused the same query to repeat.
  if (resultsUrl && currentUrl !== resultsUrl && !/naver\\.com/i.test(currentUrl)) return false;

  searchWindow.show();
  if (searchWindow.isMinimized()) searchWindow.restore();
  searchWindow.focus();
  await wait(350);

  const target = await searchWindow.webContents.executeJavaScript(\`(() => {
    const expected = \${JSON.stringify(expectedUrl)};
    const clean = (value) => String(value || "").split("#")[0];
    const identity = (value) => {
      try {
        const parsed = new URL(clean(value));
        for (const key of ["productId", "nvMid", "itemId", "goodsNo"]) {
          const found = parsed.searchParams.get(key);
          if (found) return key + ":" + found;
        }
        const segments = parsed.pathname.split("/").filter(Boolean);
        return parsed.origin + ":" + (segments.at(-1) || "");
      } catch {
        return clean(value);
      }
    };
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width >= 40
        && rect.height >= 30;
    };

    const expectedIdentity = identity(expected);
    const links = [...document.querySelectorAll("a[href]")];
    let link = links.find((candidate) => clean(candidate.href) === expected)
      || links.find((candidate) => identity(candidate.href) === expectedIdentity)
      || links.find((candidate) => {
        try {
          const left = new URL(clean(candidate.href));
          const right = new URL(expected);
          return left.origin === right.origin && left.pathname === right.pathname;
        } catch {
          return false;
        }
      });
    if (!link) return null;

    const card = link.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]")
      || link.parentElement
      || link;
    const image = link.querySelector("img,picture img") || card?.querySelector?.("img,picture img");
    const clickElement = image && visible(image) ? image : (visible(link) ? link : card);
    if (!clickElement) return null;

    clickElement.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = clickElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + Math.min(rect.height / 2, 180)),
      href: String(link.href || ""),
    };
  })()\`, true).catch(() => null);

  if (!target || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) {
    return false;
  }

  // Lock before clicking. From this point the same product must never restart
  // the Naver search, even when the page transition is delayed or fails.
  naverProductClickAttempts.add(clickAttemptKey);

  const bounds = searchWindow.getContentBounds();
  const clientX = Math.round(Number(target.x));
  const clientY = Math.round(Number(target.y));
  const clicked = await moveWindowsCursorAndClick(
    bounds.x + clientX,
    bounds.y + clientY,
    650,
  ).catch(() => ({ ok: false }));

  if (!clicked?.ok && !searchWindow.isDestroyed()) {
    // One fallback click at the exact same rendered card coordinate. No retry
    // loop and no second search submission.
    searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: clientX, y: clientY });
    searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: clientX, y: clientY, button: "left", clickCount: 1 });
    await wait(90);
    searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: clientX, y: clientY, button: "left", clickCount: 1 });
  }

  await wait(1_200);

  // Reaching the click stage is considered handled. Detail/stock verification
  // may report its own failure, but it must not re-submit this product search.
  return true;
}
`;

source = prefix + replacement + source.slice(end);
await writeFile(targetPath, source, "utf8");
console.log("Replaced Naver product-card click flow: one search, one card click attempt, no re-entry after click stage.");
