import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("release finalizer does not insert a second Naver result navigation", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "aroundg-release-finalizer-"));
  try {
    await mkdir(join(fixture, "scripts"));
    await copyFile(new URL("../main.mjs", import.meta.url), join(fixture, "main.mjs"));
    await copyFile(
      new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url),
      join(fixture, "scripts/patch-naver-result-link-finalizer.mjs"),
    );
    const run = spawnSync(process.execPath, [join(fixture, "scripts/patch-naver-result-link-finalizer.mjs")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const patched = await readFile(join(fixture, "main.mjs"), "utf8");
    assert.equal((patched.match(/const resultPage = await loadNaverFashionTownResultPage\(/g) || []).length, 1);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Musinsa accepts its exact result DOM without waiting for the page load event", () => {
  const loader = main.slice(main.indexOf("async function loadMusinsaResultPage"), main.indexOf("async function renderedSearchSourceResult"));
  assert.match(loader, /const navigation = searchWindow\.loadURL\(targetUrl\)/);
  assert.match(loader, /if \(state\?\.ready\) return/);
  assert.match(main, /if \(!directNaverFashionResult && !musinsaSource\) try/);
  assert.match(main, /if \(musinsaSource\) \{[\s\S]*?loadMusinsaResultPage/);
});
