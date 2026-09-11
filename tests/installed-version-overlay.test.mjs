import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, packageSource] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("domestic loading screen identifies the actually running app version", () => {
  assert.match(renderer, /let installedAppVersion = ""/);
  assert.match(renderer, /실행 버전 \$\{installedAppVersion/);
  assert.match(renderer, /installedAppVersion = String\(appInfo\?\.version/);
});

test("Windows installer cannot create another user-selected install directory", () => {
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false);
});
