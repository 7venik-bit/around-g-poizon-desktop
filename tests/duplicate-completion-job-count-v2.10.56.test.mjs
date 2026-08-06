import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const normalizedRenderer = renderer.replace(/\r\n/g, "\n");

test("download completion count excludes failed and still-running jobs", () => {
  assert.match(renderer, /function brandJobIsDownloaded/);
  assert.match(
    renderer,
    /const completedJobs = jobs\.filter\(\(job\) => brandJobIsDownloaded\(job\.state\)\)\.length/
  );
  assert.match(
    renderer,
    /const completionLabel = `다운로드 완료 \$\{completedJobs\}\/\$\{jobs\.length\}개`/
  );
});

test("detected Excel completion repairs the registered live job brand", () => {
  const importBlock = normalizedRenderer.match(
    /async function importDetectedBrandExport[\s\S]*?\n}\n\nasync function drainDetectedBrandImports/
  )?.[0] || "";
  assert.ok(importBlock);
  assert.match(importBlock, /const expectedBrand = detectedBrand \|\| registeredBrand/);
  assert.doesNotMatch(importBlock, /selectedBrandName/);
});
