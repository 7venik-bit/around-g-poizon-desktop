import { readFile } from "node:fs/promises";

// Legacy compatibility command. The retailer list and verdict engine are
// loaded directly at runtime; never append generated code to sourcing-view.
const bootstrap = String(await readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"));
const index = String(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
if (!bootstrap.includes("domesticInlineResultsSource") || !bootstrap.includes("domesticResultVerdictSource")) {
  throw new Error("canonical domestic runtime loaders are missing");
}
if (!index.includes("domestic-result-verdict.js")) {
  throw new Error("canonical domestic verdict script is missing from index.html");
}
console.log("domestic inline renderer already uses canonical runtime sources; no source mutation applied");
