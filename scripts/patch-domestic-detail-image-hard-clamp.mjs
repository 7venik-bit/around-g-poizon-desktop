import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-around-g-domestic-image-clamp";
if (sourcing.includes(marker)) {
  console.log("domestic detail image hard clamp already applied");
  process.exit(0);
}

const runtimeClamp = `

(() => {
  const marker = "data-around-g-domestic-image-clamp";
  if (document.documentElement.hasAttribute(marker)) return;
  document.documentElement.setAttribute(marker, "true");

  const selector = [
    "#excel-preview-rows .excel-product-search-detail img",
    "#explorer-product-grid .domestic-inventory img",
    ".domestic-source-list img",
    ".sourcing-product-list-row img"
  ].join(",");

  const hardClampImage = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    image.width = 44;
    image.height = 44;
    image.style.setProperty("width", "44px", "important");
    image.style.setProperty("height", "44px", "important");
    image.style.setProperty("max-width", "44px", "important");
    image.style.setProperty("max-height", "44px", "important");
    image.style.setProperty("min-width", "44px", "important");
    image.style.setProperty("min-height", "44px", "important");
    image.style.setProperty("object-fit", "contain", "important");
    image.style.setProperty("object-position", "center", "important");
    image.style.setProperty("display", "block", "important");
    image.style.setProperty("margin", "0", "important");
    image.style.setProperty("flex", "0 0 44px", "important");

    const thumb = image.closest(".sourcing-product-thumb");
    if (thumb) {
      thumb.style.setProperty("width", "44px", "important");
      thumb.style.setProperty("height", "44px", "important");
      thumb.style.setProperty("max-width", "44px", "important");
      thumb.style.setProperty("max-height", "44px", "important");
      thumb.style.setProperty("min-width", "44px", "important");
      thumb.style.setProperty("overflow", "hidden", "important");
      thumb.style.setProperty("flex", "0 0 44px", "important");
    }

    const imageLink = image.closest(".excel-image-cell a");
    if (imageLink) {
      imageLink.style.setProperty("display", "block", "important");
      imageLink.style.setProperty("width", "44px", "important");
      imageLink.style.setProperty("height", "44px", "important");
      imageLink.style.setProperty("max-width", "44px", "important");
      imageLink.style.setProperty("max-height", "44px", "important");
      imageLink.style.setProperty("overflow", "hidden", "important");
    }
  };

  const clampWithin = (root = document) => {
    if (root instanceof HTMLImageElement && root.matches(selector)) hardClampImage(root);
    if (!root?.querySelectorAll) return;
    root.querySelectorAll(selector).forEach(hardClampImage);
  };

  clampWithin(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) clampWithin(node);
      }
    }
  });

  [document.querySelector("#excel-preview-rows"), document.querySelector("#explorer-product-grid")]
    .filter(Boolean)
    .forEach((root) => observer.observe(root, { childList: true, subtree: true }));
})();
`;

sourcing = `${sourcing.trimEnd()}${runtimeClamp}`;
await writeFile(sourcingPath, sourcing, "utf8");
console.log("domestic detail images are hard-clamped to 44x44 at DOM insertion time");
