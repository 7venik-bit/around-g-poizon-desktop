import assert from "node:assert/strict";
import test from "node:test";
import {
  currentOfficialMallAuditEndAt,
  isOfficialMallAuditWindow,
  nextOfficialMallAuditStartAt,
} from "../services/official-mall-schedule.mjs";

test("daytime startup schedules the full verification for the next 1 AM", () => {
  const now = new Date(2026, 7, 21, 10, 30);
  const next = nextOfficialMallAuditStartAt(now);
  assert.equal(next.getDate(), 22);
  assert.equal(next.getHours(), 1);
  assert.equal(next.getMinutes(), 0);
});

test("startup before 1 AM waits until 1 AM on the same day", () => {
  const now = new Date(2026, 7, 21, 0, 30);
  const next = nextOfficialMallAuditStartAt(now);
  assert.equal(next.getDate(), 21);
  assert.equal(next.getHours(), 1);
});

test("the automatic audit may run only from 1 AM until before 6 AM", () => {
  assert.equal(isOfficialMallAuditWindow(new Date(2026, 7, 21, 0, 59)), false);
  assert.equal(isOfficialMallAuditWindow(new Date(2026, 7, 21, 1, 0)), true);
  assert.equal(isOfficialMallAuditWindow(new Date(2026, 7, 21, 5, 59)), true);
  assert.equal(isOfficialMallAuditWindow(new Date(2026, 7, 21, 6, 0)), false);
});

test("the overnight cutoff is 6 AM", () => {
  const end = currentOfficialMallAuditEndAt(new Date(2026, 7, 21, 1, 15));
  assert.equal(end.getDate(), 21);
  assert.equal(end.getHours(), 6);
  assert.equal(end.getMinutes(), 0);
});
