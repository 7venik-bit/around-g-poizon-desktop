import { readFile, writeFile } from "node:fs/promises";

const preloadPath = new URL("../preload.cjs", import.meta.url);
let source = await readFile(preloadPath, "utf8");

const anchor = 'window.addEventListener("DOMContentLoaded", () => {';
if (!source.includes(anchor)) throw new Error("preload DOMContentLoaded anchor not found");
if (!source.includes('data-musinsa-watchlist="true"')) {
  source = source.replace(anchor, `${anchor}\n  if (!document.querySelector('link[data-musinsa-watchlist="true"]')) {\n    const stylesheet = document.createElement("link");\n    stylesheet.rel = "stylesheet";\n    stylesheet.href = "./musinsa-watchlist.css";\n    stylesheet.dataset.musinsaWatchlist = "true";\n    document.head.appendChild(stylesheet);\n  }\n  if (!document.querySelector('script[data-musinsa-watchlist="true"]')) {\n    const script = document.createElement("script");\n    script.src = "./musinsa-watchlist.js";\n    script.dataset.musinsaWatchlist = "true";\n    document.head.appendChild(script);\n  }`);
}

await writeFile(preloadPath, source, "utf8");
console.log("Musinsa watchlist UI assets enabled.");
