import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

if (!main.includes('ipcMain.handle("domestic:open-result"')) throw new Error("internal result IPC missing");
if (!main.includes("existing.show()") || !main.includes("existing.focus()")) throw new Error("existing result window is not reused");
if (!main.includes("partition: DOMESTIC_SEARCH_PARTITION")) throw new Error("persistent domestic session missing");
if (!preload.includes("openDomesticResult")) throw new Error("preload bridge missing");
if (!renderer.includes("data-domestic-result-url")) throw new Error("internal result button missing");
if (!renderer.includes("window.aroundG.openDomesticResult")) throw new Error("internal result click missing");
console.log("controlled domestic result window verified");
