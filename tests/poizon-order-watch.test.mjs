import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_WATCH_TABS,
  buildWatchAlarms,
  detectWatchPageProblem,
  diffWatchSnapshots,
  mapWatchExportColumns,
  mapWatchExportRows,
  summarizeWatchSnapshot,
  watchDayKey,
  watchStatusKey,
  watchTabLabel,
} from "../services/poizon-order-watch.mjs";

test("watch tabs cover the five seller-center statuses", () => {
  assert.deepEqual(ORDER_WATCH_TABS.map((tab) => tab.key), ["all", "awaiting", "shipped", "success", "failed"]);
  assert.equal(watchTabLabel("awaiting"), "발송 대기");
  assert.equal(watchTabLabel("unknown-key"), "");
});

test("status labels map to watch keys", () => {
  assert.equal(watchStatusKey("발송 대기"), "awaiting");
  assert.equal(watchStatusKey("발송 완료"), "shipped");
  assert.equal(watchStatusKey("판매자 발송 완료"), "shipped");
  assert.equal(watchStatusKey("거래 성공"), "success");
  assert.equal(watchStatusKey("거래 실패"), "failed");
  assert.equal(watchStatusKey("주문 취소"), "failed");
  assert.equal(watchStatusKey(""), "unknown");
  assert.equal(watchStatusKey("준비 중"), "unknown");
});

test("export sheets map Korean columns to watch rows", () => {
  const sheet = [
    ["주문번호", "상품명", "상품 번호", "색상", "사이즈", "SKU_ID", "주문 상태", "발송 기한"],
    ["2131512212287993299", "데상트 스니커즈 기타 남녀공용", "SR323LSN75", "화이트-WHT0", "EU 40", "116421647", "발송 대기", "2026-10-14까지 발송"],
    ["invalid-row", "무시 상품", "XX", "", "", "", "발송 대기", ""],
  ];
  const mapped = mapWatchExportRows(sheet);
  assert.equal(mapped.rows.length, 1);
  const row = mapped.rows[0];
  assert.equal(row.orderNumber, "2131512212287993299");
  assert.equal(row.productName, "데상트 스니커즈 기타 남녀공용");
  assert.equal(row.articleNumber, "SR323LSN75");
  assert.equal(row.statusKey, "awaiting");
  assert.match(row.deadlineText, /발송/);
});

test("export sheets map Chinese columns and skip title rows", () => {
  const sheet = [
    ["POIZON 订单导出", "", "", ""],
    ["订单号", "商品名称", "货号", "订单状态"],
    ["2131512212287993299", "李宁T恤", "ABCD1234", "待发货"],
  ];
  const mapped = mapWatchExportRows(sheet);
  assert.equal(mapped.rows.length, 1);
  assert.equal(mapped.rows[0].statusKey, "awaiting");
  assert.equal(mapped.rows[0].articleNumber, "ABCD1234");
  assert.throws(() => mapWatchExportRows([["foo", "bar"]]), /POIZON_ORDER_EXPORT_COLUMNS_UNKNOWN/);
  assert.deepEqual(mapWatchExportRows([]), { headers: [], rows: [] });
});

test("export column finder prefers exact headers", () => {
  const columns = mapWatchExportColumns(["상태메모", "주문 상태", "상품명"]);
  assert.equal(columns.status, 1);
  assert.equal(columns.orderNumber, -1);
});

test("snapshots summarize per-status counts", () => {
  const summary = summarizeWatchSnapshot([
    { statusKey: "awaiting" },
    { status: "거래 성공" },
    { status: "거래 성공" },
    { status: "거래 실패" },
    { status: "" },
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.byKey.awaiting, 1);
  assert.equal(summary.byKey.success, 2);
  assert.equal(summary.byKey.failed, 1);
  assert.equal(summary.byKey.unknown, 1);
});

test("diff finds new orders and real status changes only", () => {
  const prev = { rows: [
    { orderNumber: "1111111111111111", status: "발송 대기", statusKey: "awaiting" },
    { orderNumber: "2222222222222222", status: "발송 대기", statusKey: "awaiting" },
    { orderNumber: "3333333333333333", status: "", statusKey: "unknown" },
  ] };
  const next = { rows: [
    { orderNumber: "1111111111111111", status: "발송 대기", statusKey: "awaiting" },
    { orderNumber: "2222222222222222", status: "거래 성공", statusKey: "success" },
    { orderNumber: "3333333333333333", status: "거래 성공", statusKey: "success" },
    { orderNumber: "4444444444444444", status: "발송 대기", statusKey: "awaiting", productName: "새 상품" },
  ] };
  const diff = diffWatchSnapshots(prev, next);
  assert.deepEqual(diff.newOrders.map((row) => row.orderNumber), ["4444444444444444"]);
  assert.equal(diff.statusChanges.length, 1);
  assert.equal(diff.statusChanges[0].orderNumber, "2222222222222222");
  assert.equal(diff.statusChanges[0].fromKey, "awaiting");
  assert.equal(diff.statusChanges[0].toKey, "success");
  assert.equal(diff.counts.total, 4);
});

test("alarms aggregate with stable daily keys", () => {
  const diff = {
    newOrders: [{ orderNumber: "4444444444444444", productName: "새 상품", statusKey: "awaiting" }],
    statusChanges: [
      { orderNumber: "5555555555555555", fromKey: "success", toKey: "awaiting", to: "발송 대기", row: { orderNumber: "5555555555555555", productName: "긴급" } },
      { orderNumber: "6666666666666666", fromKey: "awaiting", toKey: "failed", to: "거래 실패", row: { orderNumber: "6666666666666666", productName: "취소건" } },
      { orderNumber: "7777777777777777", fromKey: "awaiting", toKey: "success", to: "거래 성공", row: { orderNumber: "7777777777777777", productName: "완료건" } },
    ],
  };
  const alarms = buildWatchAlarms(diff, "2026-10-12");
  const byTitle = Object.fromEntries(alarms.map((alarm) => [alarm.title, alarm]));
  assert.ok(byTitle["신규 주문 1건"]);
  assert.equal(byTitle["신규 주문 1건"].windows, true);
  assert.equal(byTitle["신규 주문 1건"].key, "order-watch:new:2026-10-12");
  assert.ok(byTitle["발송 대기 1건 · 처리 필요"].windows);
  assert.ok(byTitle["거래 실패·취소 1건"].windows);
  assert.equal(byTitle["주문 상태 변경 1건"].windows, false);
  assert.deepEqual(buildWatchAlarms({ newOrders: [], statusChanges: [] }, "2026-10-12"), []);
});

test("day keys are local calendar dates", () => {
  assert.match(watchDayKey(new Date(2026, 9, 12)), /^2026-10-12$/);
});

test("login walls are detected before the ready timeout", () => {
  assert.equal(detectWatchPageProblem({ url: "https://seller.poizon.com/passport/login", text: "", tabs: [] }), true);
  assert.equal(detectWatchPageProblem({ url: "https://seller.poizon.com/main/orders/management", text: "QR코드로 로그인", tabs: [] }), true);
  assert.equal(detectWatchPageProblem({ url: "https://seller.poizon.com/main/orders/management", text: "", tabs: [], passwordInput: true }), true);
  assert.equal(detectWatchPageProblem({ url: "https://seller.poizon.com/main/orders/management", text: "전체 (70)", tabs: ["전체 (70)"] }), false);
  assert.equal(detectWatchPageProblem({ url: "https://seller.poizon.com/main/orders/management", text: "", tabs: [] }), false);
});
