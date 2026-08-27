import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-compact-sourcing-list-style";
if (sourcing.includes(marker)) {
  console.log("compact sourcing list UI already applied");
  process.exit(0);
}

const compactUi = `

(() => {
  if (document.querySelector("style[data-compact-sourcing-list-style]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-compact-sourcing-list-style", "true");
  style.textContent = \`
    /* Compact research-list density inspired by product-research/sourcing tables. */
    #excel-preview-grid{font-size:11px!important}
    #excel-preview-grid th{font-size:10px!important;padding:8px 9px!important;white-space:nowrap!important}
    #excel-preview-grid .excel-product-row td{height:48px!important;padding:7px 9px!important}
    #excel-preview-grid .excel-product-image img{width:38px!important;height:38px!important;max-width:38px!important;max-height:38px!important;object-fit:contain!important}

    #excel-preview-grid .excel-product-search-detail td{padding:5px 8px!important;white-space:normal!important;background:#fff!important;border-left:3px solid #e5e7eb!important}
    #excel-preview-grid .excel-product-search-detail.excel-product-group-blue td,
    #excel-preview-grid .excel-product-search-detail.excel-product-group-amber td{background:#fff!important}
    #excel-preview-grid .excel-product-search-result-label{margin:0 0 5px!important;padding:4px 7px!important;border-radius:6px!important;background:#f8fafc!important;color:#526173!important;font-size:10px!important}
    #excel-preview-grid .excel-product-search-result-label strong{max-width:680px!important;color:#25364a!important}

    #excel-preview-grid .domestic-source-list.sourcing-product-list{gap:0!important;border:1px solid #e4e8ed!important;border-radius:8px!important;box-shadow:none!important;background:#fff!important}
    #excel-preview-grid .sourcing-product-list-row{grid-template-columns:58px minmax(0,1fr) 118px!important;gap:10px!important;min-height:70px!important;padding:7px 10px!important;border-bottom:1px solid #edf0f3!important;background:#fff!important}
    #excel-preview-grid .sourcing-product-list-row:nth-child(even){background:#fbfcfd!important}
    #excel-preview-grid .sourcing-product-list-row:hover{background:#f6f9fc!important}

    #excel-preview-grid .sourcing-product-thumb{width:56px!important;height:56px!important;min-width:56px!important;border-radius:6px!important;background:#f7f8fa!important;color:#9aa3ad!important;font-size:9px!important;border:1px solid #eceff2!important}
    #excel-preview-grid .sourcing-product-thumb img,
    #excel-preview-grid .excel-product-search-detail img{width:56px!important;height:56px!important;max-width:56px!important;max-height:56px!important;object-fit:contain!important;margin:0!important;border-radius:6px!important;background:#fff!important}

    #excel-preview-grid .sourcing-product-info{gap:2px!important;justify-content:center!important}
    #excel-preview-grid .sourcing-product-store{gap:5px!important;font-size:10px!important;line-height:1.2!important;color:#657181!important}
    #excel-preview-grid .sourcing-product-store .official{padding:2px 5px!important;font-size:9px!important}
    #excel-preview-grid .sourcing-product-title{font-size:12px!important;line-height:1.35!important;margin:0!important;display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;overflow:hidden!important}
    #excel-preview-grid .sourcing-product-meta{gap:4px 8px!important;font-size:10px!important;line-height:1.2!important;color:#7b8591!important}

    #excel-preview-grid .sourcing-product-actions{min-width:118px!important;gap:5px!important;justify-content:center!important}
    #excel-preview-grid .sourcing-product-price{font-size:12px!important;line-height:1.2!important}
    #excel-preview-grid .sourcing-product-actions button{min-width:92px!important;padding:6px 8px!important;border-radius:6px!important;font-size:10px!important}

    #excel-preview-grid .sourcing-source-fallback{grid-template-columns:minmax(120px,170px) minmax(90px,1fr) 92px!important;gap:8px!important;min-height:42px!important;padding:7px 10px!important;border-bottom:1px solid #edf0f3!important;background:#fff!important}
    #excel-preview-grid .sourcing-source-fallback:nth-child(even){background:#fbfcfd!important}
    #excel-preview-grid .sourcing-source-fallback strong{font-size:11px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    #excel-preview-grid .sourcing-source-fallback span{display:inline-flex!important;width:max-content!important;max-width:100%!important;align-items:center!important;padding:3px 7px!important;border-radius:999px!important;background:#ecfdf3!important;color:#147a4a!important;font-size:10px!important;font-weight:800!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    #excel-preview-grid .sourcing-source-fallback button{min-width:86px!important;padding:6px 7px!important;border-radius:6px!important;font-size:10px!important;font-weight:800!important}

    #excel-preview-grid .sourcing-list-empty{padding:14px!important;font-size:11px!important}

    @media (max-width:980px){
      #excel-preview-grid .sourcing-product-list-row{grid-template-columns:50px minmax(0,1fr)!important;min-height:62px!important}
      #excel-preview-grid .sourcing-product-thumb,
      #excel-preview-grid .sourcing-product-thumb img,
      #excel-preview-grid .excel-product-search-detail img{width:48px!important;height:48px!important;max-width:48px!important;max-height:48px!important;min-width:48px!important}
      #excel-preview-grid .sourcing-product-actions{grid-column:2!important;flex-direction:row!important;justify-content:flex-start!important;align-items:center!important;width:auto!important}
      #excel-preview-grid .sourcing-source-fallback{grid-template-columns:minmax(100px,145px) minmax(80px,1fr) 86px!important}
    }
  \`;
  document.head.appendChild(style);
})();
`;

await writeFile(sourcingPath, `${sourcing.trimEnd()}${compactUi}`, "utf8");
console.log("compact sourcing list UI applied: small thumbnails, dense rows, neutral table styling");
