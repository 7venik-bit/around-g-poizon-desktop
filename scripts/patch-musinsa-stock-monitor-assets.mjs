import { readFile, writeFile } from "node:fs/promises";
const preloadPath = new URL("../preload.cjs", import.meta.url);
let source = await readFile(preloadPath, "utf8");
const anchor = 'window.addEventListener("DOMContentLoaded", () => {';
if (!source.includes(anchor)) throw new Error("DOMContentLoaded anchor missing");
if (!source.includes('data-musinsa-stock-monitor="true"')) {
  source = source.replace(anchor, `${anchor}\n  if (!document.querySelector('script[data-musinsa-stock-monitor="true"]')) {\n    const script = document.createElement("script");\n    script.src = "./musinsa-stock-monitor.js";\n    script.dataset.musinsaStockMonitor = "true";\n    document.head.appendChild(script);\n  }`);
}
await writeFile(preloadPath, source, "utf8");
console.log("Musinsa stock monitor asset enabled.");
