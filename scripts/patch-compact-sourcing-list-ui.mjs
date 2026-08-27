import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-compact-sourcing-list-style";
if (sourcing.includes(marker)) {
  console.log("compact sourcing table-list UI already applied");
  process.exit(0);
}

const compactUi = `

(() => {
  if (document.querySelector("style[data-compact-sourcing-list-style]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-compact-sourcing-list-style", "true");
  style.textContent = \`
    /* One product per row. Compact sourcing-table layout for every product renderer. */
    #explorer-product-grid{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid #e5e7eb!important;border-radius:8px!important;overflow:hidden!important;background:#fff!important}
    #explorer-product-grid>.product-selection-toolbar{margin:0!important;padding:7px 9px!important;border-bottom:1px solid #e5e7eb!important;background:#f8fafc!important}
    #explorer-product-grid .explorer-product-row{display:grid!important;grid-template-columns:32px minmax(0,1fr) 68px!important;gap:8px!important;align-items:center!important;min-height:56px!important;margin:0!important;padding:6px 9px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}
    #explorer-product-grid .explorer-product-row:nth-of-type(even){background:#fbfcfd!important}
    #explorer-product-grid .explorer-product-row:hover{background:#f6f9fc!important}
    #explorer-product-grid .rank-number{width:26px!important;height:26px!important;border-radius:6px!important;font-size:10px!important;line-height:1!important}
    #explorer-product-grid .product-summary{display:grid!important;grid-template-columns:44px minmax(0,1fr)!important;gap:8px!important;align-items:center!important;min-width:0!important}
    #explorer-product-grid .product-summary img,
    #explorer-product-grid .product-summary .image-placeholder,
    #explorer-product-grid .seller-product-info img,
    #explorer-product-grid .seller-product-info .image-placeholder{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;min-width:44px!important;object-fit:contain!important;border-radius:5px!important;margin:0!important;background:#fff!important}
    #explorer-product-grid .product-summary h3{margin:2px 0!important;font-size:11px!important;line-height:1.25!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;min-height:0!important}
    #explorer-product-grid .product-summary p{margin:0!important;font-size:9px!important;line-height:1.2!important;color:#6b7280!important}
    #explorer-product-grid .explorer-product-meta{margin:2px 0 0!important;font-size:9px!important;line-height:1.2!important;gap:8px!important}
    #explorer-product-grid .product-badges{gap:3px!important}
    #explorer-product-grid .badge{padding:2px 5px!important;font-size:8px!important;line-height:1.1!important}
    #explorer-product-grid .product-select-option{justify-self:end!important;margin:0!important;font-size:9px!important;white-space:nowrap!important}

    /* Domestic matches are subordinate rows, never large cards. */
    #explorer-product-grid .domestic-inventory{grid-column:2/-1!important;margin:0!important;padding:5px 0 0!important;border-top:1px solid #f0f2f4!important;min-width:0!important}
    #explorer-product-grid .inventory-heading{min-height:28px!important;margin:0 0 4px!important;gap:6px!important}
    #explorer-product-grid .inventory-heading button{padding:4px 7px!important;border-radius:5px!important;font-size:9px!important}
    .domestic-source-list.sourcing-product-list{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid #e5e7eb!important;border-radius:6px!important;overflow:hidden!important;background:#fff!important;box-shadow:none!important}
    .sourcing-product-list-row{display:grid!important;grid-template-columns:44px minmax(0,1fr) 100px!important;gap:8px!important;align-items:center!important;min-height:56px!important;padding:5px 7px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}
    .sourcing-product-list-row:nth-child(even){background:#fbfcfd!important}
    .sourcing-product-thumb{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;min-width:44px!important;border-radius:5px!important;border:1px solid #eceff2!important;overflow:hidden!important;background:#f8fafc!important;font-size:8px!important}
    .sourcing-product-thumb img{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;object-fit:contain!important;margin:0!important;background:#fff!important}
    .sourcing-product-info{gap:1px!important;min-width:0!important}
    .sourcing-product-store{gap:4px!important;font-size:9px!important;line-height:1.2!important}
    .sourcing-product-store .official{padding:2px 5px!important;font-size:8px!important}
    .sourcing-product-title{margin:0!important;font-size:11px!important;line-height:1.25!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}
    .sourcing-product-meta{gap:4px 7px!important;font-size:9px!important;line-height:1.15!important}
    .sourcing-product-actions{min-width:100px!important;gap:3px!important;justify-content:center!important}
    .sourcing-product-price{font-size:10px!important;line-height:1.1!important}
    .sourcing-product-actions button{min-width:82px!important;padding:5px 6px!important;border-radius:5px!important;font-size:9px!important}
    .sourcing-source-fallback{display:grid!important;grid-template-columns:minmax(110px,155px) minmax(80px,1fr) 84px!important;gap:7px!important;align-items:center!important;min-height:36px!important;padding:5px 7px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important}
    .sourcing-source-fallback:nth-child(even){background:#fbfcfd!important}
    .sourcing-source-fallback strong{font-size:10px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .sourcing-source-fallback span{display:inline-flex!important;width:max-content!important;max-width:100%!important;align-items:center!important;padding:2px 6px!important;border-radius:999px!important;background:#ecfdf3!important;color:#147a4a!important;font-size:9px!important;font-weight:800!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .sourcing-source-fallback button{min-width:78px!important;padding:4px 6px!important;border-radius:5px!important;font-size:9px!important;font-weight:800!important}

    /* Seller-result path uses a separate renderer; keep it equally dense. */
    #explorer-product-grid .seller-result-table{overflow:auto!important;background:#fff!important}
    #explorer-product-grid .seller-result-row{min-height:58px!important;margin:0!important;padding:5px 7px!important;border-radius:0!important;border-bottom:1px solid #edf0f3!important;background:#fff!important;box-shadow:none!important}
    #explorer-product-grid .seller-result-row:nth-child(even){background:#fbfcfd!important}
    #explorer-product-grid .seller-product-info{display:grid!important;grid-template-columns:22px 44px minmax(0,1fr)!important;gap:7px!important;align-items:center!important;min-width:0!important}
    #explorer-product-grid .seller-product-info code,#explorer-product-grid .seller-product-info small{font-size:9px!important;line-height:1.15!important}
    #explorer-product-grid .seller-product-info strong{font-size:10px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}

    /* Excel/product view follows the same visual density. */
    #excel-preview-grid{font-size:10px!important}
    #excel-preview-grid th{font-size:9px!important;padding:6px 7px!important;white-space:nowrap!important}
    #excel-preview-grid td{padding:5px 7px!important}
    #excel-preview-grid .excel-product-row td{height:42px!important}
    #excel-preview-grid img{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;object-fit:contain!important;margin:0 auto!important;border-radius:5px!important;background:#fff!important}
    #excel-preview-grid .excel-product-image img{width:34px!important;height:34px!important;max-width:34px!important;max-height:34px!important}
    #excel-preview-grid .excel-product-search-detail td{padding:4px 6px!important;background:#fff!important;border-left:2px solid #e5e7eb!important}
    #excel-preview-grid .excel-product-search-result-label{margin:0 0 4px!important;padding:3px 6px!important;border-radius:5px!important;background:#f8fafc!important;font-size:9px!important}

    @media (max-width:980px){
      #explorer-product-grid .explorer-product-row{grid-template-columns:28px minmax(0,1fr) 58px!important;min-height:52px!important;padding:5px 7px!important}
      #explorer-product-grid .product-summary{grid-template-columns:40px minmax(0,1fr)!important}
      #explorer-product-grid .product-summary img,
      #explorer-product-grid .product-summary .image-placeholder,
      #explorer-product-grid .seller-product-info img,
      #explorer-product-grid .seller-product-info .image-placeholder,
      .sourcing-product-thumb,
      .sourcing-product-thumb img{width:40px!important;height:40px!important;max-width:40px!important;max-height:40px!important;min-width:40px!important}
      .sourcing-product-list-row{grid-template-columns:40px minmax(0,1fr) 86px!important;min-height:52px!important}
      .sourcing-source-fallback{grid-template-columns:minmax(95px,135px) minmax(70px,1fr) 76px!important}
    }
  \`;
  document.head.appendChild(style);
})();
`;

await writeFile(sourcingPath, `${sourcing.trimEnd()}${compactUi}`, "utf8");
console.log("compact sourcing table-list UI applied across explorer, seller, domestic, and Excel renderers");
