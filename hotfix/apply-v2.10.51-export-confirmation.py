from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


main = read("main.mjs")

# 1) Read every real table row with a plausible job number. Do not require one
# exact localized task label, because POIZON changes the export-center wording.
reader_start = main.index("async function readSellerExportJobs()")
rows_start = main.index("    const rows =", reader_start)
body_start = main.index("    const bodyText = textOf(document.body);", rows_start)
new_rows = '''    const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
      .filter(visible);
    const jobs = rows.map((row) => {
      const text = textOf(row);
      const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
      const firstCellText = textOf(cells[0]);
      const id = firstCellText.match(/\\b\\d{7,}\\b/)?.[0]
        || text.match(/\\b\\d{7,}\\b/)?.[0]
        || "";
      const looksLikeDataRow = cells.length >= 2 && Boolean(id);
      return looksLikeDataRow
        ? { id, fingerprint: id || text.slice(0, 240), text }
        : null;
    }).filter(Boolean);
'''
main = main[:rows_start] + new_rows + main[body_start:]

# 2) Resolve the text label to the actual clickable button or link.
verify_start = main.index("async function verifyCompleteSellerExportAndClick")
export_start = main.index("    const exportPattern = /^전체", verify_start)
disabled_start = main.index("    if (exportButton.disabled", export_start)
new_export_lookup = '''    const exportPattern = /^전체\\\\s*내보내기$/;
    let exportButton = null;
    for (let attempt = 0; attempt < 20 && !exportButton; attempt += 1) {
      const labelElement = [...document.querySelectorAll("button, [role='button'], a, span")]
        .find((element) => visible(element) && exportPattern.test(normalizedText(element)));
      exportButton = labelElement?.closest?.("button, [role='button'], a") || labelElement || null;
      if (!exportButton) await wait(250);
    }
    if (!exportButton) return { ok: false, code: "EXPORT_BUTTON_NOT_FOUND_AFTER_VERIFICATION", expected, actual: expected };
'''
main = main[:export_start] + new_export_lookup + main[disabled_start:]

# 3) Complete every confirmation layer. Do not proceed to the download center
# until the dialogs disappear or POIZON displays an accepted/success state.
confirmation_start = main.index("    clickLikeUser(exportButton);", export_start)
return_start = main.index("    return {\n      ok: true,", confirmation_start)
new_confirmation = '''    clickLikeUser(exportButton);
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
      if (!confirmationObserved && !exportRetried && attempt == 12) {
        clickLikeUser(exportButton);
        exportRetried = true;
        await wait(900);
        continue;
      }
      await wait(250);
    }
    if (!requestAcknowledged) {
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
'''
main = main[:confirmation_start] + new_confirmation + main[return_start:]

old_fields = '''      confirmationObserved,
      confirmationClicked,
      requestAcknowledged,
    };'''
new_fields = '''      confirmationObserved,
      confirmationClicked,
      confirmationClickCount,
      requestAcknowledged,
      exportRetried,
    };'''
if old_fields not in main:
    raise RuntimeError("confirmation result fields not found")
main = main.replace(old_fields, new_fields, 1)
write("main.mjs", main)

# 4) Stop the remaining selected-brand queue after the first registration
# failure. Previously every selected brand repeated the same three-minute error.
renderer = read("src/renderer.js")
old_failure = '''  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = automation?.message || "판매자센터 데이터 가져오기 작업이 생성되지 않았습니다.";
    activeExportBrand = null;
    setTimeout(() => exportNextSelectedBrand(generation), 400);
  } else {'''
new_failure = '''  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    const failedBrandName = activeExportBrand?.name || "선택 브랜드";
    brandExportQueue = [];
    activeExportBrand = null;
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = `${failedBrandName} 작업 실패 · 나머지 선택 브랜드 자동 실행을 중단했습니다. · ${automation?.message || "판매자센터 데이터 가져오기 작업이 생성되지 않았습니다."}`;
    if (brandExportJobs.size) {
      touchBrandActivity("이미 등록된 작업만 계속 감시 중");
      await window.aroundG.startSellerBrandExportMonitor();
    } else {
      stopBrandActivity();
    }
    return;
  } else {'''
if old_failure not in renderer:
    raise RuntimeError("renderer brand queue failure block not found")
renderer = renderer.replace(old_failure, new_failure, 1)
write("src/renderer.js", renderer)

# 5) Keep all release metadata and version-specific tests synchronized.
package = json.loads(read("package.json"))
package["version"] = "2.10.51"
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")
lock = json.loads(read("package-lock.json"))
lock["version"] = "2.10.51"
lock.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.51"
write("package-lock.json", json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

for test_path in [
    "tests/brand-export-recovery.test.mjs",
    "tests/search-service-menu.test.mjs",
    "tests/release-delivery.test.mjs",
]:
    write(test_path, read(test_path).replace("2.10.50", "2.10.51"))

write("tests/export-job-registration-v2.10.51.test.mjs", '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("export uses the clickable control and completes every confirmation dialog", () => {
  assert.match(main, /labelElement\\?\\.closest/);
  assert.match(main, /confirmationClickCount \\+= 1/);
  assert.match(main, /remainingDialogs/);
  assert.match(main, /if \\(!requestAcknowledged\\)/);
  assert.match(main, /EXPORT_REQUEST_NOT_CONFIRMED/);
  assert.match(main, /exportRetried = true/);
});

test("download center discovers jobs by job number instead of one localized label", () => {
  assert.match(main, /firstCellText\\.match/);
  assert.match(main, /looksLikeDataRow/);
  assert.match(main, /\\\\d\\{7,/);
  assert.doesNotMatch(main, /상품\\\\s\\*검색\\.\\*내보내기/);
});

test("one failed brand stops the remaining automatic brand queue", () => {
  assert.match(renderer, /brandExportQueue = \\[\\]/);
  assert.match(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);
  assert.match(renderer, /이미 등록된 작업만 계속 감시 중/);
});

test("release metadata is 2.10.51", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.51");
  assert.equal(JSON.parse(lockSource).version, "2.10.51");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.51");
});
''')
