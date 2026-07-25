import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../services/store.mjs";

test("75페이지에서 Excel 전환을 요구한다", async () => {
  const store = new JsonStore(await mkdtemp(join(tmpdir(), "around-g-")));
  await store.load();
  const state = await store.updateCollector({ page: 75, fingerprint: "a", captcha: false });
  assert.equal(state.status, "export-required");
});

test("보안 퍼즐에서는 자동 진행하지 않는다", async () => {
  const store = new JsonStore(await mkdtemp(join(tmpdir(), "around-g-")));
  await store.load();
  const state = await store.updateCollector({ page: 10, fingerprint: "a", captcha: true });
  assert.equal(state.status, "captcha");
});

test("같은 페이지가 세 번 관찰되면 반복을 중단한다", async () => {
  const store = new JsonStore(await mkdtemp(join(tmpdir(), "around-g-")));
  await store.load();
  await store.updateCollector({ page: 10, fingerprint: "same", captcha: false });
  await store.updateCollector({ page: 10, fingerprint: "same", captcha: false });
  const state = await store.updateCollector({ page: 10, fingerprint: "same", captcha: false });
  assert.equal(state.status, "export-required");
  assert.match(state.reason, /반복/);
});

test("로컬 데이터는 재시작 후 유지된다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "around-g-"));
  const first = new JsonStore(dir);
  await first.load();
  await first.upsert("products", { name: "테스트 상품", articleNumber: "TEST-1" });
  const second = new JsonStore(dir);
  await second.load();
  assert.equal(second.list("products")[0].articleNumber, "TEST-1");
});
