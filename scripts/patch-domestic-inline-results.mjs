import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
const overridePath = new URL("../src/domestic-inline-results.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");
const override = String(await readFile(overridePath, "utf8")).replace(/\r\n/g, "\n").trim();

const marker = "data-domestic-inline-list-style";
if (sourcing.includes(marker)) {
  console.log("domestic inline-list renderer already applied");
  process.exit(0);
}

await writeFile(sourcingPath, `${sourcing.trimEnd()}\n\n${override}\n`, "utf8");
console.log("domestic search results patched to right-column inline list UI");
