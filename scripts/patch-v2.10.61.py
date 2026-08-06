from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "main.mjs"
PACKAGE = ROOT / "package.json"
LOCK = ROOT / "package-lock.json"
TESTS = ROOT / "tests"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


main = read(MAIN)
start = main.index("async function captureSellerCenterProducts() {")
next_function = main.find("\nasync function ", start + 20)
if next_function < 0:
    raise RuntimeError("captureSellerCenterProducts end not found")
block = main[start:next_function]

block = replace_once(
    block,
    "async function captureSellerCenterProducts() {\n",
    '''async function captureSellerCenterProducts() {
  const revealSellerLogin = () => {
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    sellerWindow.show();
    sellerWindow.focus();
  };
''',
    "capture login reveal helper",
)

block = replace_once(
    block,
    "    openSellerCenterWindow();",
    "    openSellerCenterWindow(SELLER_CENTER_URL, { visible: false });",
    "hidden popular seller window open",
)

block = replace_once(
    block,
    '''  mainWindow?.webContents.send("seller:capture-progress", { percent: 5, count: 0, message: "로그인 세션 확인 중" });''',
    '''  if (sellerWindow && !sellerWindow.isDestroyed()) {
    sellerWindow.hide();
    showCollectorWindow();
  }
  mainWindow?.webContents.send("seller:capture-progress", { percent: 5, count: 0, message: "로그인 세션 확인 중" });''',
    "hide existing seller window before popular capture",
)

block = replace_once(
    block,
    '''  if (!currentUrl.startsWith("https://seller.poizon.com/")) {
    return { ok: false, message: "판매자센터 인기상품 화면으로 이동해 주세요." };
  }''',
    '''  if (!currentUrl.startsWith("https://seller.poizon.com/")) {
    revealSellerLogin();
    return { ok: false, message: "판매자센터 인기상품 화면으로 이동해 주세요." };
  }''',
    "reveal invalid seller session",
)

block = replace_once(
    block,
    '''    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
      return { ok: false, message: "판매자센터 로그인을 완료해 주세요. 로그인 세션은 다음 실행부터 자동으로 유지됩니다." };
    }''',
    '''    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
      revealSellerLogin();
      return { ok: false, message: "판매자센터 로그인을 완료해 주세요. 로그인 세션은 다음 실행부터 자동으로 유지됩니다." };
    }''',
    "reveal seller login requirement",
)

main = main[:start] + block + main[next_function:]
write(MAIN, main)

for path in (PACKAGE, LOCK):
    source = read(path).replace('"version": "2.10.60"', '"version": "2.10.61"')
    write(path, source)

for path in TESTS.glob("*.mjs"):
    source = read(path).replace("2.10.60", "2.10.61")
    write(path, source)

new_test = TESTS / "hide-popular-window-v2.10.61.test.mjs"
write(new_test, '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const normalizedMain = main.replace(/\\r\\n/g, "\\n");
const captureBlock = normalizedMain.match(
  /async function captureSellerCenterProducts\\(\\) \\{[\\s\\S]*?\\n}\\n\\nasync function /
)?.[0] || "";

test("popular-product collection keeps Seller Center hidden during normal capture", () => {
  assert.ok(captureBlock);
  assert.match(captureBlock, /openSellerCenterWindow\\(SELLER_CENTER_URL, \\{ visible: false \\}\\)/);
  assert.match(captureBlock, /sellerWindow\\.hide\\(\\)/);
  assert.match(captureBlock, /showCollectorWindow\\(\\)/);
  assert.doesNotMatch(captureBlock, /openSellerCenterWindow\\(\\);/);
});

test("Seller Center appears only when login attention is required", () => {
  assert.match(captureBlock, /const revealSellerLogin = \\(\\) =>/);
  assert.match(captureBlock, /sellerWindow\\.show\\(\\)/);
  assert.match(captureBlock, /sellerWindow\\.focus\\(\\)/);
  assert.match(captureBlock, /revealSellerLogin\\(\\);[\\s\\S]*판매자센터 로그인을 완료해 주세요/);
});

test("release metadata is 2.10.61", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.61");
  assert.equal(JSON.parse(lockSource).version, "2.10.61");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.61");
});
''')

print("Applied v2.10.61 hidden popular-product Seller Center patch")
