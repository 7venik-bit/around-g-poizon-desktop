import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-product-image-text-alignment";
if (sourcing.includes(marker)) {
  console.log("product image/text alignment already applied");
  process.exit(0);
}

const alignmentPatch = `

(() => {
  if (document.querySelector("style[data-product-image-text-alignment]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-product-image-text-alignment", "true");
  style.textContent = \`
    /* Keep thumbnails and their first text line on one visual baseline. */
    #explorer-product-grid .product-summary,
    #explorer-product-grid .seller-product-info,
    .candidate-summary,
    .sourcing-product-list-row{align-items:start!important}

    #explorer-product-grid .product-summary>img,
    #explorer-product-grid .product-summary>.image-placeholder,
    #explorer-product-grid .seller-product-info>img,
    #explorer-product-grid .seller-product-info>.image-placeholder,
    .candidate-summary>.candidate-image,
    .sourcing-product-thumb{align-self:start!important;margin-top:0!important}

    #explorer-product-grid .product-summary>div,
    #explorer-product-grid .seller-product-info>div,
    .candidate-summary>span,
    .sourcing-product-info{align-self:start!important;margin-top:0!important;padding-top:0!important;min-width:0!important}

    #explorer-product-grid .product-summary h3,
    #explorer-product-grid .product-summary p,
    .candidate-summary b,
    .candidate-summary small,
    .sourcing-product-store,
    .sourcing-product-title,
    .sourcing-product-meta{margin-top:0!important}

    .sourcing-product-actions{align-self:center!important}
  \`;
  document.head.appendChild(style);
})();
`;

await writeFile(sourcingPath, `${sourcing.trimEnd()}${alignmentPatch}`, "utf8");
console.log("product thumbnails and text blocks are top-aligned consistently");
