import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const normalizedMain = main.replace(/\r\n/g, "\n");
const captureBlock = normalizedMain.match(
  /async function captureSellerCenterProducts\(\) \{[\s\S]*?\n}\n\nasync function /
)?.[0] || "";

test("popular-product collection keeps Seller Center hidden during normal capture", () => {
  assert.ok(captureBlock);
  assert.match(captureBlock, /openSellerCenterWindow\(SELLER_CENTER_URL, \{ visible: false \}\)/);
  assert.match(captureBlock, /sellerWindow\.hide\(\)/);
  assert.match(captureBlock, /showCollectorWindow\(\)/);
  assert.doesNotMatch(captureBlock, /openSellerCenterWindow\(\);/);
});

test("Seller Center appears only when login attention is required", () => {
  assert.match(captureBlock, /const revealSellerLogin = \(\) =>/);
  assert.match(captureBlock, /sellerWindow\.show\(\)/);
  assert.match(captureBlock, /sellerWindow\.focus\(\)/);
  assert.match(captureBlock, /if \(!currentUrl\.startsWith\("https:\/\/seller\.poizon\.com\/"\)\) \{\n    revealSellerLogin\(\)/);
  assert.match(captureBlock, /revealSellerLogin\(\);[\s\S]*판매자센터 로그인을 완료해 주세요/);
});

test("release metadata is 2.10.190", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.190");
  assert.equal(JSON.parse(lockSource).version, "2.10.190");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.190");
});
