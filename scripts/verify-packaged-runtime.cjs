const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");

module.exports = async function verifyPackagedRuntime(context) {
  const asarPath = join(context.appOutDir, "resources", "app.asar");
  if (!existsSync(asarPath)) {
    throw new Error(`packaged app.asar missing: ${asarPath}`);
  }

  let asar;
  try {
    asar = require("@electron/asar");
  } catch (error) {
    throw new Error(`@electron/asar is required for packaged runtime verification: ${error.message}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), "around-g-asar-check-"));
  try {
    for (const relativePath of ["main.mjs", "bootstrap.mjs", "relay/domestic-search.mjs"]) {
      const extracted = asar.extractFile(asarPath, relativePath);
      if (!extracted || extracted.length === 0) {
        throw new Error(`packaged runtime file missing or empty: ${relativePath}`);
      }
      const outputPath = join(scratch, relativePath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, extracted);
      const check = spawnSync(process.execPath, ["--check", outputPath], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (check.status !== 0) {
        process.stderr.write(check.stdout || "");
        process.stderr.write(check.stderr || "");
        throw new Error(`packaged runtime syntax check failed: ${relativePath}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log("Packaged app.asar runtime syntax verified");
};
