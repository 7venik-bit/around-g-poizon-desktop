import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [releaseWorkflow, packageWorkflow, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/windows-package-test.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("release build and local asset validation happen before tag creation", () => {
  const buildIndex = releaseWorkflow.indexOf("name: Build Windows installer");
  const validateIndex = releaseWorkflow.indexOf("name: Validate and normalize local release assets");
  const tagIndex = releaseWorkflow.indexOf("name: Ensure release tag exists after successful build");
  const publishIndex = releaseWorkflow.indexOf("name: Publish and verify release assets");

  assert.ok(buildIndex >= 0, "Windows build step must exist");
  assert.ok(validateIndex > buildIndex, "local assets must be validated after the build");
  assert.ok(tagIndex > validateIndex, "the release tag must be created only after asset validation");
  assert.ok(publishIndex > tagIndex, "release assets must be published after tag creation");
});

test("release workflow verifies all three updater assets", () => {
  assert.match(releaseWorkflow, /Around-G-POIZON-Setup-\$version\.exe/);
  assert.match(releaseWorkflow, /latest\.yml does not reference/);
  assert.match(releaseWorkflow, /Release asset verification failed/);
  assert.match(releaseWorkflow, /expected 3 assets/);
});

test("pull requests build the real Windows installer", () => {
  assert.match(packageWorkflow, /runs-on: windows-latest/);
  assert.match(packageWorkflow, /electron-builder --win nsis --publish never/);
  assert.match(packageWorkflow, /dist\/latest\.yml/);
  assert.match(packageWorkflow, /Expected exactly one Windows installer/);
});

test("release metadata is synchronized at 2.10.148", () => {
  const packageJson = JSON.parse(packageSource);
  const lockJson = JSON.parse(lockSource);
  assert.equal(packageJson.version, "2.10.148");
  assert.equal(lockJson.version, "2.10.148");
  assert.equal(lockJson.packages[""].version, "2.10.148");
});
