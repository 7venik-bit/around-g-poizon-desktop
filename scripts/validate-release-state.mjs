import { readFile } from "node:fs/promises";

const fail = (message) => {
  console.error(`Release validation failed: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(String(pkg.version || ""))) fail(`invalid package version ${pkg.version}`);
if (!pkg?.build?.publish || pkg.build.publish.provider !== "github") fail("GitHub publish configuration missing");
if (!pkg?.build?.files?.includes("relay/**/*")) fail("relay files are not packaged");
if (!pkg?.build?.files?.includes("scripts/**/*") && String(pkg.scripts?.postinstall || "").includes("scripts/")) {
  // Patch scripts run only during build/install; they do not need to ship in the app.
}

const source = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const needles = [
  '{ store: "무신사", parser: parseMusinsaSearch, renderCount: true }',
  'store: officialStoreLabel',
  '{ store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true }',
  '{ store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true }',
  '{ store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true }',
  '{ store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) }',
  '{ store: "병행수입·편집샵", linkOnly: true, retailerDiscovery: true, renderCount: true }',
];
let cursor = -1;
for (const needle of needles) {
  const next = source.indexOf(needle, cursor + 1);
  if (next < 0) fail(`domestic source order missing: ${needle}`);
  cursor = next;
}

const exactModelPatch = await readFile(new URL("./patch-ssg-lotte-exact-model-counts.mjs", import.meta.url), "utf8");
if (!/SSG/i.test(exactModelPatch) || !/Lotte|롯데/i.test(exactModelPatch)) fail("SSG/Lotte exact-model patch is incomplete");

const releaseWorkflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
for (const required of ["electron-builder --win nsis", "latest.yml", "Create release, tag, and upload assets", "Verify published release assets"]) {
  if (!releaseWorkflow.includes(required)) fail(`release workflow missing: ${required}`);
}

console.log(`Release validation passed for ${pkg.version}.`);
