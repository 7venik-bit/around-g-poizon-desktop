import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const store = await readFile(new URL("../services/store.mjs", import.meta.url), "utf8");

test("100 percent review persists a per-brand completion record", () => {
  assert.match(store, /brandVerifications: \[\]/);
  assert.match(renderer, /fileReport\?\.complete !== true/);
  assert.match(renderer, /fileReport\?\.autoCorrection !== "POIZON_AUTO_CORRECTION_APPLIED"/);
  assert.match(renderer, /upsert\("brandVerifications"/);
  assert.match(renderer, /await saveBrandVerificationResults\(files, report\)/);
  assert.match(renderer, /listBrandExportFiles/);
  assert.match(renderer, /currentByPath/);
  assert.match(renderer, /currentByPath\.get\(brandImportPathKey\(suppliedFile\.path\)\)/);
});

test("completion record uses workbook metadata after POIZON corrections", () => {
  const start = renderer.indexOf("async function saveBrandVerificationResults");
  const end = renderer.indexOf("function poizonSyncForFile", start);
  const source = renderer.slice(start, end);
  assert.ok(source.indexOf("listBrandExportFiles") < source.indexOf('upsert("brandVerifications"'));
  assert.match(source, /fileTime: Number\(file\.time \|\| file\.mtimeMs \|\| 0\)/);
  assert.match(source, /downloadedBrandFiles = downloadedBrandFiles\.map/);
});

test("brand verification is valid for 7 days and invalidated by a new workbook", () => {
  const start = renderer.indexOf("const BRAND_VERIFICATION_REFRESH_MS");
  const end = renderer.indexOf("function poizonSyncForFile", start);
  const source = renderer.slice(start, end);
  const now = Date.now();
  const context = createContext({
    Date,
    state: { brandVerifications: [{ brandId: 7, filePath: "C:/brand.xlsx", fileTime: 10, verifiedAt: new Date(now - 6 * 86400000).toISOString() }] },
    brandImportPathKey: (value) => String(value).toLowerCase().replaceAll("/", "\\"),
    latestCompletedBrandDownload: () => null,
  });
  runInContext(source, context);
  assert.equal(context.brandVerificationFor({ id: 7 }, { path: "C:/brand.xlsx", time: 10 }).expired, false);
  assert.equal(context.brandVerificationFor({ id: 7 }, { path: "C:/brand.xlsx", time: now - 30 * 86400000 }).expired, false);
  context.state.brandVerifications[0].verifiedAt = new Date(now - 8 * 86400000).toISOString();
  assert.equal(context.brandVerificationFor({ id: 7 }, { path: "C:/brand.xlsx", time: 10 }).expired, true);
  assert.equal(context.brandVerificationFor({ id: 7 }, { path: "C:/brand.xlsx", time: now + 1_000 }), null);
});

test("brand card shows completion, date, and monthly refresh state", () => {
  assert.match(renderer, /verification\.expired \? "갱신 필요" : "검증 완료"/);
  assert.match(renderer, /brand-verification-date/);
  assert.match(renderer, /verification-\$\{verification\.expired \? "expired" : "complete"\}/);
});

test("brand verification refresh interval is weekly and does not auto-run a review", () => {
  assert.match(renderer, /BRAND_VERIFICATION_REFRESH_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(renderer, /refreshAfterDays: 7/);
  const start = renderer.indexOf("function brandVerificationFor");
  const end = renderer.indexOf("async function saveBrandVerificationResults", start);
  assert.doesNotMatch(renderer.slice(start, end), /captureSellerBrandSales|openVerifiedCombinedBrandPreview/);
});
