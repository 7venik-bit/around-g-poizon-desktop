import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const required = {
  "main.mjs": ["POIZON_PAGE_TRANSACTION_GATE", "POIZON_SKU_SAFE_PAGE_SELECTION", "selectPoizonPageCorrectionProducts", "syncPoizonPageCheckpoint"],
  "src/renderer.js": ["openReviewLocalBrandPreview", "poizon-review-brand-start"],
  "src/index.html": ["header-brand-layout-styles"],
  "src/style.css": ["#official-domain-audit-toggle::after{content:'공식몰'", "HEADER_BUTTON_SIZING_V1"],
  "services/live-poizon-crosscheck.mjs": ["assertPoizonPageReadyForCorrection", "selectPoizonPageCorrectionProducts"],
  "services/poizon-review-session.mjs": ["runPoizonReviewBatch", "syncExcelWithSellerScreen"],
};

for (const [file, markers] of Object.entries(required)) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${file}: integrated source marker missing: ${marker}`);
  }
}

for (const file of ["main.mjs", "preload.cjs", "src/renderer.js", "src/live-poizon-crosscheck.js", "src/poizon-review-workspace.js"]) {
  const check = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (check.status !== 0) process.exit(check.status ?? 1);
}

const tests = spawnSync(process.execPath, ["scripts/run-current-tests.mjs"], { stdio: "inherit" });
process.exitCode = tests.status ?? 1;
