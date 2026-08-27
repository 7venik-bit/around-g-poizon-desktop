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
    /* Product layout rule: image stays on the left, copy stays on the right. */
    #explorer-product-grid .product-summary,
    .candidate-summary{
      display:flex!important;
      flex-direction:row!important;
      align-items:flex-start!important;
      gap:8px!important;
      min-width:0!important;
    }

    #explorer-product-grid .product-summary>img,
    #explorer-product-grid .product-summary>.image-placeholder{
      flex:0 0 44px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    #explorer-product-grid .product-summary>div{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .candidate-summary>.candidate-image{
      flex:0 0 48px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    .candidate-summary>span{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .sourcing-product-list-row{
      display:flex!important;
      flex-direction:row!important;
      align-items:flex-start!important;
      gap:8px!important;
      min-width:0!important;
    }

    .sourcing-product-thumb{
      flex:0 0 44px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    .sourcing-product-info{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .sourcing-product-actions{
      flex:0 0 100px!important;
      align-self:center!important;
      margin-left:auto!important;
    }

    #explorer-product-grid .seller-product-info{
      align-items:flex-start!important;
    }

    #explorer-product-grid .product-summary h3,
    #explorer-product-grid .product-summary p,
    .candidate-summary b,
    .candidate-summary small,
    .sourcing-product-store,
    .sourcing-product-title,
    .sourcing-product-meta{
      margin-top:0!important;
    }

    /* Excel product rows remain tables, but image and identity cells share the same top line. */
    #excel-preview-grid .excel-product-row .excel-product-image,
    #excel-preview-grid .excel-product-row .excel-product-image+td,
    #excel-preview-grid .excel-product-row .excel-product-image+td+td,
    #excel-preview-grid .excel-product-row .excel-product-image+td+td+td{
      vertical-align:top!important;
    }
  \`;
  document.head.appendChild(style);
})();
`;

await writeFile(sourcingPath, `${sourcing.trimEnd()}${alignmentPatch}`, "utf8");
console.log("product images are fixed left with text blocks directly to the right");
