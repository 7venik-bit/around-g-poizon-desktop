import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep this workflow hook for compatibility, but restore the historically
// working popular-list implementation instead of replacing its table scope or
// scroll collector.
await import("./patch-popular-rankboard-scope.mjs");

// This is the final source-mutating workflow hook before Windows packaging.
// Validate the exact source state produced by every earlier patch. A release
// must stop here if any patch introduced a main-process syntax error.
for (const relativePath of ["../main.mjs", "../bootstrap.mjs", "../relay/domestic-search.mjs"]) {
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const check = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (check.status !== 0) {
    process.stderr.write(check.stdout || "");
    process.stderr.write(check.stderr || "");
    throw new Error(`final runtime syntax check failed: ${relativePath}`);
  }
}

console.log("known-good popular list capture preserved; final runtime syntax verified");
