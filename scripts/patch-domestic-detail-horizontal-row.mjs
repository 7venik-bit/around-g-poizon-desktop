import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-around-g-domestic-horizontal-row";
if (sourcing.includes(marker)) {
  console.log("domestic detail horizontal row layout already applied");
  process.exit(0);
}

const runtimeLayout = `

(() => {
  const marker = "data-around-g-domestic-horizontal-row";
  if (document.documentElement.hasAttribute(marker)) return;
  document.documentElement.setAttribute(marker, "true");

  const important = (element, property, value) => {
    if (!element) return;
    element.style.setProperty(property, value, "important");
  };

  const layoutSourcingRow = (row) => {
    if (!(row instanceof Element)) return;
    important(row, "display", "grid");
    important(row, "grid-template-columns", "44px minmax(0, 1fr) 104px");
    important(row, "grid-template-rows", "auto");
    important(row, "align-items", "center");
    important(row, "column-gap", "9px");
    important(row, "row-gap", "0");
    important(row, "width", "100%");
    important(row, "min-height", "56px");
    important(row, "padding", "5px 7px");
    important(row, "margin", "0");
    important(row, "box-sizing", "border-box");

    const thumb = row.querySelector(":scope > .sourcing-product-thumb");
    if (thumb) {
      important(thumb, "grid-column", "1");
      important(thumb, "grid-row", "1");
      important(thumb, "align-self", "center");
      important(thumb, "justify-self", "start");
      important(thumb, "margin", "0");
    }

    const info = row.querySelector(":scope > .sourcing-product-info");
    if (info) {
      important(info, "grid-column", "2");
      important(info, "grid-row", "1");
      important(info, "display", "flex");
      important(info, "flex-direction", "column");
      important(info, "justify-content", "center");
      important(info, "align-items", "flex-start");
      important(info, "gap", "2px");
      important(info, "min-width", "0");
      important(info, "width", "100%");
      important(info, "margin", "0");
    }

    const actions = row.querySelector(":scope > .sourcing-product-actions");
    if (actions) {
      important(actions, "grid-column", "3");
      important(actions, "grid-row", "1");
      important(actions, "display", "flex");
      important(actions, "flex-direction", "column");
      important(actions, "justify-content", "center");
      important(actions, "align-items", "flex-end");
      important(actions, "gap", "4px");
      important(actions, "min-width", "0");
      important(actions, "width", "104px");
      important(actions, "margin", "0");
    }

    row.querySelectorAll(".sourcing-product-store,.sourcing-product-title,.sourcing-product-meta,.sourcing-product-price").forEach((element) => {
      important(element, "margin", "0");
    });
  };

  const layoutFallbackRow = (row) => {
    if (!(row instanceof Element)) return;
    important(row, "display", "grid");
    important(row, "grid-template-columns", "150px minmax(0, 1fr) 90px");
    important(row, "align-items", "center");
    important(row, "gap", "8px");
    important(row, "width", "100%");
    important(row, "min-height", "36px");
    important(row, "padding", "5px 7px");
    important(row, "margin", "0");
    important(row, "box-sizing", "border-box");
  };

  const layoutLegacyCandidate = (summary) => {
    if (!(summary instanceof Element)) return;
    important(summary, "display", "grid");
    important(summary, "grid-template-columns", "44px minmax(0, 1fr)");
    important(summary, "align-items", "center");
    important(summary, "gap", "8px");
    important(summary, "min-width", "0");
    const image = summary.querySelector(":scope > img");
    const textBlock = summary.querySelector(":scope > span");
    if (image) {
      important(image, "grid-column", "1");
      important(image, "grid-row", "1");
      important(image, "margin", "0");
    }
    if (textBlock) {
      important(textBlock, "grid-column", "2");
      important(textBlock, "grid-row", "1");
      important(textBlock, "display", "flex");
      important(textBlock, "flex-direction", "column");
      important(textBlock, "justify-content", "center");
      important(textBlock, "min-width", "0");
      important(textBlock, "margin", "0");
    }
  };

  const layoutWithin = (root = document) => {
    if (root instanceof Element) {
      if (root.matches(".sourcing-product-list-row")) layoutSourcingRow(root);
      if (root.matches(".sourcing-source-fallback")) layoutFallbackRow(root);
      if (root.matches(".candidate-summary")) layoutLegacyCandidate(root);
    }
    if (!root?.querySelectorAll) return;

    root.querySelectorAll(".domestic-source-list.sourcing-product-list").forEach((list) => {
      important(list, "display", "flex");
      important(list, "flex-direction", "column");
      important(list, "width", "100%");
      important(list, "gap", "0");
    });
    root.querySelectorAll(".sourcing-product-list-row").forEach(layoutSourcingRow);
    root.querySelectorAll(".sourcing-source-fallback").forEach(layoutFallbackRow);
    root.querySelectorAll(".excel-product-search-detail .candidate-summary, .domestic-inventory .candidate-summary").forEach(layoutLegacyCandidate);
  };

  layoutWithin(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) layoutWithin(node);
      }
    }
  });

  [document.querySelector("#excel-preview-rows"), document.querySelector("#explorer-product-grid")]
    .filter(Boolean)
    .forEach((root) => observer.observe(root, { childList: true, subtree: true }));
})();
`;

sourcing = `${sourcing.trimEnd()}${runtimeLayout}`;
await writeFile(sourcingPath, sourcing, "utf8");
console.log("domestic detail products now render as horizontal rows: image | data | price/action");
