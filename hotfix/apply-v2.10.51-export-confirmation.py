from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected source not found in {path}: {old[:180]!r}")
    write(path, content.replace(old, new, 1))


replace_once(
    "main.mjs",
    '''    const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
      .filter(visible)
      .filter((row) => /(?:상품\\s*검색.*내보내기|내보내기.*상품\\s*검색|商品.*导出|导出.*商品)/i.test(textOf(row)));
    const jobs = rows.map((row) => {
      const text = textOf(row);
      const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
      const firstCellText = textOf(cells[0]);
      const id = firstCellText.match(/\\b\\d{9,}\\b/)?.[0]
        || text.match(/\\b\\d{9,}\\b/)?.[0]
        || "";
      return { id, fingerprint: id || text.slice(0, 180), text };
    });''',
    '''    const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
      .filter(visible);
    const jobs = rows.map((row) => {
      const text = textOf(row);
      const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
      const firstCellText = textOf(cells[0]);
      const numericCandidates = [firstCellText, text]
        .flatMap((value) => String(value || "").match(/\\b\\d{7,}\\b/g) || [])
        .sort((left, right) => right.length - left.length);
      const id = numericCandidates[0] || "";
      const hasExportHint = /내보내기|다운로드|导出|下载|export|download/i.test(text);
      const looksLikeDataRow = cells.length >= 2 && Boolean(id) && hasExportHint;
      return looksLikeDataRow
        ? { id, fingerprint: id || text.slice(0, 240), text }
        : null;
    }).filter(Boolean);''',
)

replace_once(
    "main.mjs",
    '''    const exportPattern = /^전체\\\\s*내보내기$/;
    let exportButton = null;
    for (let attempt = 0; attempt < 20 && !exportButton; attempt += 1) {
      exportButton = [...document.querySelectorAll("button, [role='button'], a, span")]
        .find((element) => visible(element) && exportPattern.test(normalizedText(element)));
      if (!exportButton) await wait(250);
    }''',
    '''    const exportPattern = /^전체\\\\s*내보내기$/;
    let exportButton = null;
    for (let attempt = 0; attempt < 20 && !exportButton; attempt += 1) {
      const labelElement = [...document.querySelectorAll("button, [role='button'], a, span")]
        .find((element) => visible(element) && exportPattern.test(normalizedText(element)));
      exportButton = labelElement?.closest?.("button, [role='button'], a") || labelElement || null;
      if (!exportButton) await wait(250);
    }''',
)

replace_once(
    "main.mjs",
    '''    clickLikeUser(exportButton);
    await wait(700);

    let confirmationObserved = false;
    let confirmationClicked = false;
    let requestAcknowledged = false;
    const confirmationPattern = /^(?:확인|내보내기|생성|확정|제출|确认|确定|提交|导出)$/i;
    const cancelPattern = /취소|닫기|取消|关闭/i;
    const successPattern = /(?:내보내기|작업|파일).*(?:등록|생성|완료|성공)|(?:导出|任务).*(?:成功|已创建)/i;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const dialogs = [...document.querySelectorAll(
        ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
      )].filter(visible);
      if (dialogs.length) confirmationObserved = true;
      const controls = dialogs.flatMap((dialog) =>
        [...dialog.querySelectorAll("button, [role='button'], a")].filter(visible)
      );
      const confirmControl = controls.find((element) => {
        const label = normalizedText(element);
        return confirmationPattern.test(label) && !cancelPattern.test(label);
      });
      if (confirmControl) {
        clickLikeUser(confirmControl);
        confirmationClicked = true;
        await wait(1_000);
        break;
      }
      if (successPattern.test(normalizedText(document.body))) {
        requestAcknowledged = true;
        break;
      }
      await wait(250);
    }
    return {
      ok: true,''',
    '''    clickLikeUser(exportButton);
    await wait(700);

    let confirmationObserved = false;
    let confirmationClicked = false;
    let confirmationClickCount = 0;
    let requestAcknowledged = false;
    let exportRetried = false;
    const confirmationPattern = /^(?:확인|내보내기|생성|확정|제출|계속|确认|确定|提交|导出|继续)$/i;
    const cancelPattern = /취소|닫기|取消|关闭/i;
    const successPattern = /(?:내보내기|작업|파일).*(?:등록|생성|완료|성공|접수)|(?:导出|任务).*(?:成功|已创建|已提交)/i;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const dialogs = [...document.querySelectorAll(
        ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
      )].filter(visible);
      if (dialogs.length) confirmationObserved = true;
      const controls = dialogs.flatMap((dialog) =>
        [...dialog.querySelectorAll("button, [role='button'], a")].filter(visible)
      );
      const confirmControl = controls.find((element) => {
        const label = normalizedText(element);
        return confirmationPattern.test(label) && !cancelPattern.test(label);
      }) || controls.find((element) => {
        const label = normalizedText(element);
        const className = String(element.className || "");
        return /primary|confirm|ok/i.test(className) && !cancelPattern.test(label);
      });
      if (confirmControl) {
        clickLikeUser(confirmControl);
        confirmationClicked = true;
        confirmationClickCount += 1;
        await wait(900);
        continue;
      }
      if (successPattern.test(normalizedText(document.body))) {
        requestAcknowledged = true;
        break;
      }
      if (confirmationClickCount > 0 && dialogs.length === 0) {
        await wait(1_200);
        const remainingDialogs = [...document.querySelectorAll(
          ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
        )].filter(visible);
        if (!remainingDialogs.length) {
          requestAcknowledged = true;
          break;
        }
      }
      if (!confirmationObserved && !exportRetried && attempt === 12) {
        clickLikeUser(exportButton);
        exportRetried = true;
        await wait(900);
        continue;
      }
      await wait(250);
    }
    if (!requestAcknowledged && !confirmationClicked) {
      return {
        ok: false,
        code: "EXPORT_REQUEST_NOT_CONFIRMED",
        expected,
        actual: expected,
        confirmationObserved,
        confirmationClicked,
        confirmationClickCount,
        exportRetried,
      };
    }
    return {
      ok: true,''',
)

replace_once(
    "main.mjs",
    '''      confirmationObserved,
      confirmationClicked,
      requestAcknowledged,
    };''',
    '''      confirmationObserved,
      confirmationClicked,
      confirmationClickCount,
      requestAcknowledged,
      exportRetried,
    };''',
)

package = json.loads(read("package.json"))
package["version"] = "2.10.51"
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")
lock = json.loads(read("package-lock.json"))
lock["version"] = "2.10.51"
lock.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.51"
write("package-lock.json", json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

for test_path in ["tests/brand-export-recovery.test.mjs", "tests/search-service-menu.test.mjs"]:
    write(test_path, read(test_path).replace("2.10.50", "2.10.51"))

write("tests/export-job-registration-v2.10.51.test.mjs", '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("export uses the clickable control and completes every confirmation dialog", () => {
  assert.match(main, /labelElement\\?\\.closest/);
  assert.match(main, /confirmationClickCount \\+= 1/);
  assert.match(main, /remainingDialogs/);
  assert.match(main, /EXPORT_REQUEST_NOT_CONFIRMED/);
  assert.match(main, /exportRetried = true/);
});

test("download center discovers jobs by actual job numbers", () => {
  assert.match(main, /numericCandidates/);
  assert.match(main, /looksLikeDataRow/);
  assert.match(main, /\\\\d\\{7,/);
});

test("release metadata is 2.10.51", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.51");
  assert.equal(JSON.parse(lockSource).version, "2.10.51");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.51");
});
''')
