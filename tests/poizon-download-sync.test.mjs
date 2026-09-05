import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../services/store.mjs";

test("POIZON 화면 동기화 결과는 앱 재시작 뒤에도 보존된다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "around-g-poizon-sync-"));
  try {
    const store = new JsonStore(directory);
    await store.load();
    await store.upsert("poizonSyncs", {
      id: "seller-brand:1000444",
      filePath: "C:\\OneDrive\\kolon.xlsx",
      status: "complete",
      products: [{ articleNumber: "JWVAX25017", sales30d: 100, localSales30d: 83 }],
    });
    const reloaded = new JsonStore(directory);
    const snapshot = await reloaded.load();
    assert.equal(snapshot.poizonSyncs.length, 1);
    assert.equal(snapshot.poizonSyncs[0].products[0].sales30d, 100);
    assert.equal(snapshot.poizonSyncs[0].products[0].localSales30d, 83);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
