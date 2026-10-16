import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const verdict = readFileSync(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");

// Sourcing loading and product-search values follow the popular list:
// radar scope for loading, popular resultPresentation labels for counts.
test("sourcing batch loading and raw search cells use popular-list values", () => {
  // Loading state matches the popular resultPresentation loading label.
  assert.match(verdict, /if \(result\?\.loading\) return \{ label: "검색 중…", className: "loading" \}/);
  const loadingCells = renderer.match(/excel-raw-search-state loading">검색 중…/g) || [];
  assert.ok(loadingCells.length >= 3, `expected raw/verified/product loading cells, found ${loadingCells.length}`);
  assert.doesNotMatch(renderer, /수달 사원이 검색 중/);

  // Overall counts match the popular resultPresentation labels.
  assert.match(verdict, /`상품 \$\{products\.length/);
  assert.match(verdict, /`결과 \$\{availableCount/);
  const rawCell = renderer.slice(
    renderer.indexOf("function renderRawExcelDomesticCell"),
    renderer.indexOf("function excelPreviewProductKey"),
  );
  assert.match(rawCell, /label: `상품 \$\{/);
  assert.match(rawCell, /label: `결과 \$\{/);
  assert.doesNotMatch(rawCell, /상품 있음 ·/);

  // Batch banner reuses the popular radar scope and popular count wording.
  const bannerStart = renderer.indexOf("const renderBatchSearchProgress = (completedCount");
  const bannerEnd = renderer.indexOf("renderBatchSearchProgress(0);", bannerStart);
  const banner = renderer.slice(bannerStart, bannerEnd);
  assert.match(banner, /popular-radar-mode/);
  assert.match(banner, /popular-radar-sweep/);
  assert.match(banner, /popular-progress-count/);
  assert.match(banner, /수집 중 ·/);
});
