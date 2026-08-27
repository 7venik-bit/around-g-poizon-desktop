import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const mainPath = fileURLToPath(new URL("../main.mjs", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));

test("patched Electron main process remains syntactically valid", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", mainPath], { stdio: "pipe" }));
});

test("postinstall blocks packaging when final main process syntax is invalid", async () => {
  const pkg = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(packagePath, "utf8")));
  assert.match(String(pkg.scripts?.postinstall || ""), /node --check main\.mjs/);
});
