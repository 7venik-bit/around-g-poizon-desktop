// POIZON seller-center order watch: daily snapshot of the order management
// page (https://seller.poizon.com/main/orders/management) with new-order and
// status-change alarms. Collection uses the page's own bulk export ("전체
// 내보내기") instead of fragile tab clicks and pagination: one download
// event proves success, and every status arrives in a single file. Detail
// drawers and ledger writes never run here; the strict sale-record flow in
// poizon-order-screen.mjs / poizon-order-ledger.mjs stays untouched.

export const ORDER_WATCH_TABS = Object.freeze([
  { key: "all", label: "전체" },
  { key: "awaiting", label: "발송 대기" },
  { key: "shipped", label: "발송 완료" },
  { key: "success", label: "거래 성공" },
  { key: "failed", label: "거래 실패" },
]);

const STATUS_KEY_PATTERNS = Object.freeze([
  ["awaiting", /발송\s*대기|待发货/],
  ["shipped", /판매자\s*발송\s*완료|발송\s*완료|已发货/],
  ["success", /거래\s*성공|交易成功|已完成/],
  ["failed", /거래\s*실패|주문\s*취소|취소\s*완료|交易失败|已取消/],
]);

export function watchStatusKey(status = "") {
  const text = String(status || "").trim();
  if (!text) return "unknown";
  const found = STATUS_KEY_PATTERNS.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : "unknown";
}

export function watchTabLabel(key = "") {
  return ORDER_WATCH_TABS.find((tab) => tab.key === key)?.label || "";
}

const WATCH_KEYS = Object.freeze(["all", "awaiting", "shipped", "success", "failed", "unknown"]);

function canonicalWatchKey(row = {}) {
  if (WATCH_KEYS.includes(row?.statusKey)) return row.statusKey;
  return watchStatusKey(row?.status);
}

export function summarizeWatchSnapshot(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const byKey = { all: list.length, awaiting: 0, shipped: 0, success: 0, failed: 0, unknown: 0 };
  for (const row of list) {
    const key = canonicalWatchKey(row);
    if (key in byKey) byKey[key] += 1;
    else byKey.unknown += 1;
  }
  return { total: list.length, byKey };
}

export function diffWatchSnapshots(previous = {}, next = {}) {
  const prevRows = Array.isArray(previous?.rows) ? previous.rows : [];
  const nextRows = Array.isArray(next?.rows) ? next.rows : [];
  const prevByNumber = new Map(prevRows.map((row) => [String(row?.orderNumber || ""), row]));
  const newOrders = [];
  const statusChanges = [];
  for (const row of nextRows) {
    const orderNumber = String(row?.orderNumber || "");
    if (!/^\d{10,25}$/.test(orderNumber)) continue;
    const prev = prevByNumber.get(orderNumber);
    if (!prev) {
      newOrders.push(row);
      continue;
    }
    const fromKey = canonicalWatchKey(prev);
    const toKey = canonicalWatchKey(row);
    if (fromKey !== "unknown" && toKey !== "unknown" && fromKey !== toKey) {
      statusChanges.push({ orderNumber, from: prev?.status || "", fromKey, to: row?.status || "", toKey, row });
    }
  }
  return { newOrders, statusChanges, counts: summarizeWatchSnapshot(nextRows) };
}

function describeOrders(rows = [], limit = 5) {
  return rows.slice(0, limit).map((row) => {
    const name = String(row?.productName || "").slice(0, 18);
    return `${row?.orderNumber}${name ? `(${name})` : ""}`;
  }).join(", ") + (rows.length > limit ? ` 외 ${rows.length - limit}건` : "");
}

export function buildWatchAlarms(diff = {}, dayKey = "") {
  const alarms = [];
  const day = String(dayKey || "").trim() || "unknown-day";
  const newOrders = Array.isArray(diff?.newOrders) ? diff.newOrders : [];
  const statusChanges = Array.isArray(diff?.statusChanges) ? diff.statusChanges : [];
  if (newOrders.length) {
    const awaiting = newOrders.filter((row) => canonicalWatchKey(row) === "awaiting");
    alarms.push({
      title: `신규 주문 ${newOrders.length}건`,
      message: `${describeOrders(newOrders)}${awaiting.length ? ` · 발송 대기 ${awaiting.length}건 포함` : ""}`,
      key: `order-watch:new:${day}`,
      windows: true,
    });
  }
  const changed = statusChanges.filter((change) => change?.fromKey && change.fromKey !== "unknown");
  for (const toKey of ["awaiting", "failed"]) {
    const group = changed.filter((change) => change.toKey === toKey);
    if (!group.length) continue;
    const numbers = [...new Set(group.map((change) => change.orderNumber))].sort();
    alarms.push({
      title: toKey === "awaiting" ? `발송 대기 ${group.length}건 · 처리 필요` : `거래 실패·취소 ${group.length}건`,
      message: describeOrders(group.map((change) => change.row)),
      key: `order-watch:${toKey}:${day}:${group.length}:${numbers.slice(0, 3).join(".")}`,
      windows: true,
    });
  }
  const quiet = changed.filter((change) => !["awaiting", "failed"].includes(change.toKey));
  if (quiet.length) {
    alarms.push({
      title: `주문 상태 변경 ${quiet.length}건`,
      message: describeOrders(quiet.map((change) => change.row)),
      key: `order-watch:changed:${day}:${quiet.length}`,
      windows: false,
    });
  }
  return alarms;
}

export function watchDayKey(date = new Date()) {
  const target = date instanceof Date ? date : new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Page readiness probe shared by the page (serialized) and Node (unit tests
// call it with a fake webContents). Never call it directly in Node: it reads
// the live seller document.
export function readWatchOrderPageState() {
  return {
    url: String(location.href || ""),
    text: String(document.body?.innerText || "").slice(0, 20000),
    passwordInput: Boolean(document.querySelector('input[type="password"],input[autocomplete="current-password"]')),
    tabs: [...document.querySelectorAll('[class*="global-text-label-wrap"]')].map((node) => node.innerText.trim()).filter(Boolean),
    ready: document.readyState === "complete",
  };
}

export function watchPageProblem(state = {}) {
  const text = String(state?.text || "");
  const url = String(state?.url || "");
  if (/서비스 접속량이 많습니다|일시적인 트래픽 증가|access denied|too many requests/i.test(text)) return "POIZON_ACCESS_LIMITED";
  if (detectWatchPageProblem(state)) return "POIZON_LOGIN_REQUIRED";
  if (url && !url.startsWith("https://seller.poizon.com/")) return "POIZON_SELLER_PAGE_UNEXPECTED";
  return "";
}

// Wait until the order management SPA boots and its status tabs render.
// Without this gate every control lookup races an empty document.
export async function waitForWatchOrderPage(webContents, { timeout = 45000, interval = 800 } = {}) {
  const frame = webContents?.mainFrame;
  if (!frame) throw new Error("POIZON_ORDER_WATCH_NOT_READY");
  const stop = Date.now() + timeout;
  for (;;) {
    const state = await frame.executeJavaScript(`(${readWatchOrderPageState.toString()})()`, true).catch(() => null);
    if (state) {
      const problem = watchPageProblem(state);
      if (problem) throw new Error(problem);
      const settled = state.tabs.some((tab) => {
        const current = String(tab || "").trim();
        return current === "전체" || current.startsWith("전체 (");
      });
      if (state.ready && settled) return state;
    }
    if (Date.now() > stop || webContents.isDestroyed()) throw new Error("POIZON_ORDER_WATCH_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Seller-center login walls (QR/app login) carry no password input, so a
// bare tab check would poll until timeout. Detect them explicitly so the UI
// reports "login required" instead of a cryptic not-ready failure.
export function detectWatchPageProblem(state = {}) {
  const url = String(state?.url || "");
  const text = String(state?.text || "");
  const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
  if (/login|signin|passport|auth/i.test(url)) return true;
  if (state?.passwordInput && !tabs.length) return true;
  return tabs.length === 0
    && /로그인|sign[\s-]*in|qr\s*(code|login)?|扫码|手机.*登录/i.test(text);
}

const EXPORT_COLUMN_ALIASES = Object.freeze({
  orderNumber: ["주문번호", "주문 번호", "订单号", "订单编号"],
  productName: ["상품명", "상품 정보", "商品名称", "货品名称"],
  articleNumber: ["상품 번호", "품번", "货号", "商品编码", "款号"],
  spuId: ["SPU_ID", "SPU"],
  color: ["색상", "颜色"],
  size: ["사이즈", "尺码", "规格"],
  skuId: ["SKU_ID", "SKU"],
  status: ["주문 상태", "상태", "订单状态"],
  price: ["결제 금액", "구매자 결제 금액", "실결제금액", "付款金额"],
  income: ["예상 수익", "预计收入", "预计收益"],
  deadline: ["발송 기한", "처리 기한", "发货期限", "最晚发货"],
  date: ["주문 시간", "주문시간", "下单时间", "创建时间"],
});

function compactHeader(value = "") {
  return String(value ?? "").replace(/\s+/g, "");
}

export function mapWatchExportColumns(headers = []) {
  const clean = (Array.isArray(headers) ? headers : []).map(compactHeader);
  const find = (aliases) => {
    for (const alias of aliases) {
      const wanted = compactHeader(alias);
      const exact = clean.findIndex((header) => header === wanted);
      if (exact >= 0) return exact;
    }
    for (const alias of aliases) {
      const wanted = compactHeader(alias);
      if (!wanted) continue;
      const partial = clean.findIndex((header) => header.includes(wanted));
      if (partial >= 0) return partial;
    }
    return -1;
  };
  return {
    orderNumber: find(EXPORT_COLUMN_ALIASES.orderNumber),
    productName: find(EXPORT_COLUMN_ALIASES.productName),
    articleNumber: find(EXPORT_COLUMN_ALIASES.articleNumber),
    spuId: find(EXPORT_COLUMN_ALIASES.spuId),
    color: find(EXPORT_COLUMN_ALIASES.color),
    size: find(EXPORT_COLUMN_ALIASES.size),
    skuId: find(EXPORT_COLUMN_ALIASES.skuId),
    status: find(EXPORT_COLUMN_ALIASES.status),
    price: find(EXPORT_COLUMN_ALIASES.price),
    income: find(EXPORT_COLUMN_ALIASES.income),
    deadline: find(EXPORT_COLUMN_ALIASES.deadline),
    date: find(EXPORT_COLUMN_ALIASES.date),
  };
}

export function mapWatchExportRows(sheet = []) {
  const rows = Array.isArray(sheet) ? sheet : [];
  if (!rows.length) return { headers: [], rows: [] };
  let headerIndex = -1;
  let columns = null;
  for (let index = 0; index < Math.min(rows.length, 6); index += 1) {
    const headers = (Array.isArray(rows[index]) ? rows[index] : []).map((cell) => String(cell ?? ""));
    const mapped = mapWatchExportColumns(headers);
    const hits = [mapped.orderNumber, mapped.productName, mapped.status].filter((position) => position >= 0).length;
    if (mapped.orderNumber >= 0 && hits >= 2) {
      headerIndex = index;
      columns = mapped;
      break;
    }
  }
  if (!columns) throw new Error("POIZON_ORDER_EXPORT_COLUMNS_UNKNOWN");
  const headers = rows[headerIndex].map((cell) => String(cell ?? ""));
  const at = (cells, position) => (position < 0 ? "" : String(cells[position] ?? "").trim());
  const out = [];
  for (const cells of rows.slice(headerIndex + 1)) {
    if (!Array.isArray(cells)) continue;
    const orderNumber = at(cells, columns.orderNumber).replace(/[^0-9]/g, "");
    if (!/^\d{10,25}$/.test(orderNumber)) continue;
    const status = at(cells, columns.status);
    out.push({
      orderNumber,
      productName: at(cells, columns.productName).slice(0, 120),
      articleNumber: at(cells, columns.articleNumber).replace(/-Server Region$/i, "").slice(0, 60),
      spuId: at(cells, columns.spuId).slice(0, 40),
      imageUrl: "",
      color: at(cells, columns.color).slice(0, 60),
      size: at(cells, columns.size).slice(0, 60),
      skuId: at(cells, columns.skuId).slice(0, 60),
      status,
      statusKey: watchStatusKey(status),
      deadlineText: at(cells, columns.deadline).slice(0, 120),
      timelineText: at(cells, columns.date).slice(0, 200),
      priceText: at(cells, columns.price).slice(0, 60),
      incomeText: at(cells, columns.income).slice(0, 60),
    });
    if (out.length >= 5000) break;
  }
  return { headers, rows: out };
}
