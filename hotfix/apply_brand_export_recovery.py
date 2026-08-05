from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected source not found in {path}: {old[:160]!r}")
    write(path, content.replace(old, new, 1))


# 1) Accept current Korean/Chinese export-center row labels instead of relying
# on one exact Korean phrase.
replace_once(
    "main.mjs",
    '''    const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
      .filter(visible)
      .filter((row) => /\\uC0C1\\uD488\\uAC80\\uC0C9\\s*\\uB0B4\\uBCF4\\uB0B4\\uAE30/i.test(textOf(row)));''',
    '''    const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
      .filter(visible)
      .filter((row) => /(?:상품\\s*검색.*내보내기|내보내기.*상품\\s*검색|商品.*导出|导出.*商品)/i.test(textOf(row)));''',
)

# 2) Treat the export button as the start of a two-step action. POIZON can show
# a confirmation dialog after the first click; the previous code returned
# success after 500 ms without completing that dialog.
replace_once(
    "main.mjs",
    '''    exportButton.scrollIntoView({ block: "center", inline: "center" });
    exportButton.click();
    await wait(500);
    return {
      ok: true,''',
    '''    const clickLikeUser = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }));
      }
      element.click?.();
      return true;
    };
    clickLikeUser(exportButton);
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
)

replace_once(
    "main.mjs",
    '''      lastPageCount: lastSnapshot.keys.length,
    };''',
    '''      lastPageCount: lastSnapshot.keys.length,
      confirmationObserved,
      confirmationClicked,
      requestAcknowledged,
    };''',
)

# 3) Do not reload the export center every 3-4 seconds. Give the SPA enough
# time to render the new job row, reload only every 15 seconds, and allow up to
# three minutes for POIZON to allocate a job number.
replace_once(
    "main.mjs",
    '''  let createdJob = null;
  const verificationStartedAt = Date.now();
  while (Date.now() - verificationStartedAt < 45000) {
    const currentJobs = await readSellerExportJobs();
    if (currentJobs) createdJob = findNewSellerExportJob([...baselineJobIds], currentJobs);
    if (createdJob) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (sellerWindow && !sellerWindow.isDestroyed()) {
      await sellerWindow.webContents.reloadIgnoringCache();
    }
  }''',
    '''  let createdJob = null;
  const verificationStartedAt = Date.now();
  const verificationTimeoutMs = 180000;
  let lastReloadAt = 0;
  let lastProgressAt = 0;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  while (Date.now() - verificationStartedAt < verificationTimeoutMs) {
    const currentJobs = await readSellerExportJobs();
    if (Array.isArray(currentJobs)) {
      createdJob = findNewSellerExportJob([...baselineJobIds], currentJobs);
    }
    if (createdJob) break;

    const elapsedMs = Date.now() - verificationStartedAt;
    if (elapsedMs - lastProgressAt >= 10000) {
      lastProgressAt = elapsedMs;
      mainWindow?.webContents.send("brand-export:progress", {
        status: "waiting-for-job-creation",
        brandName,
        jobState: `2단계/5 · 다운로드센터 작업 생성 대기 · ${Math.floor(elapsedMs / 1000)}초`,
        message: `${brandName} · 전체 내보내기 요청 완료 · POIZON이 새 작업번호를 생성하는 중입니다. 화면을 반복 초기화하지 않고 기다립니다.`,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (!sellerWindow || sellerWindow.isDestroyed()) break;
    const currentUrl = sellerWindow.webContents.getURL();
    if (!currentUrl.includes("/main/exportCenter")) {
      await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
      lastReloadAt = Date.now();
    } else if (elapsedMs >= 15000 && Date.now() - lastReloadAt >= 15000) {
      await sellerWindow.webContents.reloadIgnoringCache();
      lastReloadAt = Date.now();
    }
  }''',
)

replace_once(
    "main.mjs",
    '''      code: "EXPORT_JOB_NOT_CREATED",
      message: "판매자센터에 새 데이터 파일 생성 작업이 등록되지 않았습니다. 다시 시도해 주세요.",
    };''',
    '''      code: "EXPORT_JOB_NOT_CREATED",
      confirmationObserved: Boolean(completeness?.confirmationObserved),
      confirmationClicked: Boolean(completeness?.confirmationClicked),
      requestAcknowledged: Boolean(completeness?.requestAcknowledged),
      message: completeness?.confirmationObserved && !completeness?.confirmationClicked
        ? "POIZON 전체 내보내기 확인창을 완료하지 못했습니다. 확인창 처리 로직을 다시 점검해 주세요."
        : "전체 내보내기 요청 후 3분 동안 다운로드센터의 새 작업번호가 확인되지 않았습니다. POIZON 처리 지연 또는 세션 상태를 확인해 주세요.",
    };''',
)

# Keep release metadata consistent.
package = json.loads(read("package.json"))
package["version"] = "2.10.49"
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")

lock = read("package-lock.json")
lock = re.sub(r'("version"\s*:\s*")2\.10\.\d+(\")', r'\g<1>2.10.49\2', lock, count=2)
write("package-lock.json", lock)

write(
    "tests/brand-export-recovery.test.mjs",
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("brand export completes the POIZON confirmation dialog", () => {
  assert.match(main, /confirmationPattern/);
  assert.match(main, /confirmationClicked = true/);
  assert.match(main, /clickLikeUser\(confirmControl\)/);
});

test("new export job discovery waits without constant reloads", () => {
  assert.match(main, /verificationTimeoutMs = 180000/);
  assert.match(main, /elapsedMs >= 15000/);
  assert.match(main, /화면을 반복 초기화하지 않고 기다립니다/);
  assert.doesNotMatch(main, /verificationStartedAt < 45000/);
});

test("export center recognizes localized product-search export rows", () => {
  assert.match(main, /상품\\s\*검색\.\*내보내기/);
  assert.match(main, /商品\.\*导出/);
});

test("release metadata is 2.10.49", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.49");
  assert.equal(JSON.parse(lockSource).version, "2.10.49");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.49");
});
''',
)
