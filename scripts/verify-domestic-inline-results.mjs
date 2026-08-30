import { readFile } from "node:fs/promises";

const bootstrap = String(await readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"));
const index = String(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
const inline = String(await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8"));
const verdict = String(await readFile(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

const required = [
  [bootstrap, "domesticResultVerdictSource"],
  [bootstrap, "domesticInlineResultsSource"],
  [index, "domestic-result-verdict.js"],
  [inline, "AroundGDomesticVerdict.sourceVerdict"],
  [inline, "renderExcelProductRows = inlineExcelRenderer"],
  [verdict, "Product evidence is the strongest signal"],
];
for (const [source, token] of required) {
  if (!source.includes(token)) throw new Error(`canonical domestic renderer verification failed: missing ${token}`);
}
if (sourcing.includes("data-domestic-inline-list-style")) {
  throw new Error("generated domestic inline renderer is still appended to sourcing-view.js");
}
console.log("canonical domestic inline renderer and single verdict source verified");
