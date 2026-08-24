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

let prefix = source.slice(0, start);
prefix = prefix.replace(/const naverProductClickAttempts = new Set\(\);\s*$/m, "");

const replacement = `const naverProductClickAttempts = new Set();

async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = "") {
  if (!searchWindow || searchWindow.isDestroyed()) return false;

  const expectedUrl = String(productUrl || "").split("#")[0];
  const attemptKey = expectedUrl || "__visible_card__";
  if (naverProductClickAttempts.has(attemptKey)) return true;

  searchWindow.show();
  if (searchWindow.isMinimized()) searchWindow.restore();
  searchWindow.focus();
  await wait(300);

  const target = await searchWindow.webContents.executeJavaScript(\`(() => {
    const expected = \${JSON.stringify(expectedUrl)};
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 80
        && rect.height >= 60
        && rect.bottom > 0
        && rect.top < innerHeight
        && rect.right > 0
        && rect.left < innerWidth
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0;
    };

    const links = [...document.querySelectorAll("a[href]")]
      .filter((link) => isVisible(link));

    let link = null;
    if (expected) {
      link = links.find((candidate) => String(candidate.href || "").split("#")[0] === expected) || null;
    }

    if (!link) {
      link = links.find((candidate) => {
        const card = candidate.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]") || candidate;
        const image = card.querySelector?.("img,picture img") || candidate.querySelector?.("img,picture img");
        if (!image || !isVisible(image)) return false;
        const rect = card.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 100;
      }) || null;
    }

    if (!link) return null;

    const card = link.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]") || link;
    const clickable = isVisible(link) ? link : card;
    clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = clickable.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()\`, true).catch(() => null);

  if (!target || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) {
    return false;
  }

  const bounds = searchWindow.getContentBounds();
  const physicalPoint = screen.dipToScreenPoint({
    x: Math.round(bounds.x + Number(target.x)),
    y: Math.round(bounds.y + Number(target.y)),
  });
  const clicked = await moveWindowsCursorAndClick(
    physicalPoint.x,
    physicalPoint.y,
    700,
  ).catch(() => ({ ok: false }));
  if (!clicked?.ok) return false;

  naverProductClickAttempts.add(attemptKey);
  return true;
}
`;

source = prefix + replacement + source.slice(end);
await writeFile(targetPath, source, "utf8");
console.log("Replaced Naver card flow with simple visible-card physical mouse move and one left click.");
