import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

test("G branding is used by the interface and Windows package", async () => {
  const [html, main, packageSource] = await Promise.all([
    readFile(join(root, "src/index.html"), "utf8"),
    readFile(join(root, "main.mjs"), "utf8"),
    readFile(join(root, "package.json"), "utf8"),
    access(join(root, "build/icon.png")),
    access(join(root, "build/icon.ico")),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(html, /class="brand" aria-label="Around G"><span>G<\/span>/);
  assert.doesNotMatch(html, /class="brand" aria-label="Around G"><span>A<\/span>/);
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.ok(packageJson.build.files.includes("build/icon.png"));
  assert.match(main, /const APP_ICON_PATH = join\(import\.meta\.dirname, "build", "icon\.png"\)/);
  assert.match(main, /app\.setAppUserModelId\("kr\.aroundg\.poizon"\)/);
  assert.equal((main.match(/icon: APP_ICON_PATH/g) || []).length, 6);
});
