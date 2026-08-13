import test from "node:test";
import assert from "node:assert/strict";
import {
  SITE_HEALTH_TARGETS,
  nextWeeklySiteHealthAt,
  weeklySiteHealthSummary,
} from "../services/weekly-site-health.mjs";
import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("수요일 밤 12시는 목요일 00:00로 예약한다", () => {
  const wednesday = new Date(2026, 7, 12, 15, 30);
  const next = nextWeeklySiteHealthAt(wednesday);
  assert.equal(next.getDay(), 4);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getDate(), 13);
});

test("이미 지난 목요일 00시는 다음 주로 예약한다", () => {
  const thursday = new Date(2026, 7, 13, 0, 1);
  const next = nextWeeklySiteHealthAt(thursday);
  assert.equal(next.getDate(), 20);
  assert.equal(next.getHours(), 0);
});

test("모든 국내 연동 채널과 POIZON을 포함한다", () => {
  const ids = new Set(SITE_HEALTH_TARGETS.map((target) => target.id));
  for (const id of ["poizon-seller", "poizon-kr", "naver", "musinsa", "ssg-department", "ssg-outlet", "lotte-department", "lotte-outlet", "hyundai"]) {
    assert.equal(ids.has(id), true, id);
  }
});

test("실패 사이트를 안내용 요약으로 만든다", () => {
  const summary = weeklySiteHealthSummary([
    { name: "네이버 쇼핑", ok: true },
    { name: "SSG 백화점", ok: false },
  ]);
  assert.deepEqual(summary, { total: 2, passed: 1, failed: 1, failedNames: ["SSG 백화점"], ok: false });
});

test("업데이트 후 전체 브랜드 공식몰 연동을 한 번 즉시 실행한다", () => {
  assert.match(mainSource, /async function startImmediateOfficialMallLinkage/);
  assert.match(mainSource, /syncBrandCatalogFromKrPoizon\(\)/);
  assert.match(mainSource, /await runOfficialDomainAudit\(\)/);
  assert.match(mainSource, /immediateOfficialMallLinkageVersion === version/);
});
