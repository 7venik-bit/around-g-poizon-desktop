import assert from "node:assert/strict";
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

test("나중에·바로가기 팝업은 바로가기로 승인하고 다운로드센터로 이동한다", () => {
  assert.match(main, /PHYSICAL_EXPORT_DOWNLOAD_CENTER_SHORTCUT/);
  assert.match(main, /바로\\s\*가기\|다운로드\\s\*센터\.\*바로\\s\*가기/);
  assert.match(main, /downloadCenterClicked: true/);
  assert.match(main, /confirmation\.downloadCenterClicked/);
  assert.match(main, /나중에/);
});


test("export center discovers job rows from stable job numbers across layouts and frames", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /jobsById/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});

test("an interrupted update reconnects only the same selected brand job", () => {
  assert.match(main, /function recoverableSavedBrandExportJob/);
  assert.match(main, /job\.createdAt >= cutoff/);
  assert.match(main, /visibleJobIds\.has\(job\.jobId\)/);
  assert.match(main, /sameNonEmptyBrand\(job\.brandName, brandName\)/);
  assert.match(main, /중단 전 작업번호 복구 완료 · 다운로드 감시 재개/);
  assert.match(main, /recovered: true/);
});

test("the live export path confirms POIZON submission before waiting for a job", () => {
  const workflow = main.slice(
    main.indexOf("async function automateSellerBrandExport"),
    main.indexOf("async function syncBrandCatalogFromKrPoizon"),
  );
  const exportClick = workflow.indexOf("performPhysicalSellerSortAndExport(candidate.frame)");
  const confirmation = workflow.indexOf("confirmSellerExportRequestPhysical(candidate.frame)", exportClick);
  const jobWait = workflow.indexOf("const verificationStartedAt = Date.now()", confirmation);
  assert.ok(exportClick >= 0 && confirmation > exportClick && jobWait > confirmation);
  assert.match(workflow, /lateConfirmationChecked/);
  assert.match(workflow, /confirmSellerExportRequestPhysical\(currentSellerProductFrame\(\)\)/);
  assert.match(workflow, /if \(!confirmation\?\.requestAcknowledged\)/);
  assert.match(workflow, /code: "EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED"/);
  assert.doesNotMatch(workflow, /전체 내보내기 완료 · 다음 브랜드 준비/);
});

test("exact brand selection cannot confuse PUMA with PUMA KIDS", () => {
  const start = main.indexOf("async function applyExactSellerBrandFilter");
  const end = main.indexOf("async function automateSellerBrandExport", start);
  const exactFilter = main.slice(start, end);
  assert.match(exactFilter, /return value === requested/);
  assert.doesNotMatch(exactFilter, /value\.startsWith\(requested\)/);
  assert.doesNotMatch(exactFilter, /requested\.startsWith\(value\)/);
});

test("post-search controls use the restored visible Windows cursor", () => {
  const start = main.indexOf("async function physicalClickSellerElement");
  const end = main.indexOf("async function performPhysicalSellerSortAndExport", start);
  const click = main.slice(start, end);
  assert.match(click, /sellerWindow\.showInactive\(\)/);
  assert.match(click, /moveWindowsCursorAndClick\(bounds\.x \+ point\.x, bounds\.y \+ point\.y\)/);
  assert.match(click, /physicalCursorMoved: true/);
  assert.match(main, /确认\|确定\|提交\|导出\|继续/);
});

test("POIZON daily twenty-search limit replaces the generic confirmation error", () => {
  assert.match(main, /async function detectSellerDailySearchLimit/);
  assert.match(main, /DAILY_SEARCH_LIMIT_EXCEEDED/);
  assert.match(main, /포이즌 검색 데이터는 하루 20번만 가능합니다\. 오늘 사용 가능 횟수를 초과했습니다\./);
  assert.match(main, /dailyLimit\.exceeded \? "DAILY_SEARCH_LIMIT_EXCEEDED"/);
});

test("release metadata is 2.10.314", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.314");
  assert.equal(JSON.parse(lockSource).version, "2.10.314");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.314");
});
