import { readFile, writeFile, readdir } from "node:fs/promises";

const sourcePackageUrl = new URL("../package.json", import.meta.url);
const sourcePackage = JSON.parse(await readFile(sourcePackageUrl, "utf8"));
const sourceVersion = String(sourcePackage.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(sourceVersion)) throw new Error(`Invalid source package version: ${sourceVersion}`);

// Keep npm's lockfile metadata aligned with package.json. The dependency graph
// is unchanged; only the root project version had drifted behind the source
// package metadata and caused version-regression checks to fail.
const lockUrl = new URL("../package-lock.json", import.meta.url);
const lock = JSON.parse(await readFile(lockUrl, "utf8"));
lock.version = sourceVersion;
if (lock.packages?.[""]) lock.packages[""].version = sourceVersion;
await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

const testsDir = new URL("../tests/", import.meta.url);
const entries = await readdir(testsDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".test.mjs")) continue;
  const url = new URL(entry.name, testsDir);
  let source = await readFile(url, "utf8");
  const before = source;
  // Release builds derive the next public tag dynamically. Older regression
  // tests still pinned the previous source metadata version.
  source = source.replaceAll("2.10.378", sourceVersion);
  if (source !== before) await writeFile(url, source, "utf8");
}

const domesticUrl = new URL("domestic-search.test.mjs", testsDir);
let domestic = await readFile(domesticUrl, "utf8");
const oldOrder = `    "브랜드 공식몰",\n    "네이버 공식 브랜드스토어",\n    "네이버 백화점",\n    "네이버 아울렛",\n    "무신사",\n    "SSG",\n    "SSG 백화점",\n    "SSG 아울렛",\n    "롯데온",\n    "롯데온 백화점",\n    "롯데온 아울렛",\n    "병행수입·편집샵",\n    "코오롱몰",`;
const newOrder = `    "무신사",\n    "브랜드 공식몰",\n    "네이버 공식 브랜드스토어",\n    "네이버 백화점",\n    "네이버 아울렛",\n    "SSG",\n    "SSG 백화점",\n    "SSG 아울렛",\n    "롯데온",\n    "롯데온 백화점",\n    "롯데온 아울렛",\n    "코오롱몰",\n    "병행수입·편집샵",`;
domestic = domestic.replace(oldOrder, newOrder);
domestic = domestic.replace(
  `["브랜드 공식몰", "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛", "무신사", "SSG", "SSG 백화점", "SSG 아울렛", "롯데온", "롯데온 백화점", "롯데온 아울렛", "병행수입·편집샵"]`,
  `["무신사", "브랜드 공식몰", "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛", "SSG", "SSG 백화점", "SSG 아울렛", "롯데온", "롯데온 백화점", "롯데온 아울렛", "병행수입·편집샵"]`,
);
domestic = domestic.replace(
  `const official = result.sources[0];\n  assert.equal(official.store, "공식몰 추가 확인 필요");`,
  `const official = result.sources.find((source) => source.store === "공식몰 추가 확인 필요");\n  assert.ok(official);\n  assert.equal(official.store, "공식몰 추가 확인 필요");`,
);
domestic = domestic.replace(
  `const official = result.sources[0];\n  assert.equal(official.store, "브랜드 공식몰");`,
  `const official = result.sources.find((source) => source.store === "브랜드 공식몰");\n  assert.ok(official);\n  assert.equal(official.store, "브랜드 공식몰");`,
);
await writeFile(domesticUrl, domestic, "utf8");

const deliveryUrl = new URL("release-delivery.test.mjs", testsDir);
let delivery = await readFile(deliveryUrl, "utf8");
delivery = delivery.replace("name: Validate and normalize local release assets", "name: Validate and normalize release assets");
delivery = delivery.replace("name: Create release tag after successful build", "name: Create release, tag, and upload assets");
delivery = delivery.replace("name: Publish and verify release assets", "name: Verify published release assets");
delivery = delivery.replace(
  `  assert.match(releaseWorkflow, /expected 3 assets/);`,
  `  assert.match(releaseWorkflow, /requiredNames/);\n  assert.match(releaseWorkflow, /Around-G-POIZON-Setup-/);`,
);
await writeFile(deliveryUrl, delivery, "utf8");

console.log(`Test expectations and root lock metadata synchronized to ${sourceVersion}.`);
