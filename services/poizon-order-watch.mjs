// POIZON seller-center order watch: daily list-level snapshot of the order
// management page (https://seller.poizon.com/main/orders/management) with
// new-order and status-change alarms. This path never opens detail drawers
// and never writes ledgers; the strict sale-record flow in
// poizon-order-screen.mjs / poizon-order-ledger.mjs stays untouched.

export const ORDER_WATCH_TABS = Object.freeze([
  { key: "all", label: "전체" },
  { key: "awaiting", label: "발송 대기" },
  { key: "shipped", label: "발송 완료" },
  { key: "success", label: "거래 성공" },
  { key: "failed", label: "거래 실패" },
]);

const STATUS_KEY_PATTERNS = Object.freeze([
  ["awaiting", /발송\s*대기/],
  ["shipped", /판매자\s*발송\s*완료|발송\s*완료/],
  ["success", /거래\s*성공/],
  ["failed", /거래\s*실패|주문\s*취소|취소\s*완료/],
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

function firstLine(value = "") {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
}

function labeledValue(text = "", labels = []) {
  for (const label of labels) {
    const match = String(text || "").match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`));
    if (match) return match[1].trim();
  }
  return "";
}

export function normalizeWatchRow(raw = {}) {
  const orderNumber = String(raw?.orderNumber || "").replace(/[^0-9]/g, "");
  const cells = Array.isArray(raw?.cells) ? raw.cells : [];
  const joined = cells.join("\n");
  const productInfo = String(raw?.productInfo || cells.find((cell) => /상품\s*번호\s*[:：]/.test(cell)) || cells[2] || "");
  const optionInfo = String(raw?.optionInfo || cells.find((cell) => /색상\s*[:：]|사이즈\s*[:：]|포장\s*[:：]/.test(cell)) || "");
  const productName = firstLine(productInfo.replace(/상품\s*번호\s*[:：]\s*[^\n]+\n?/, "").replace(/SPU_ID\s*[:：]\s*[^\n]+\n?/, "")) || firstLine(productInfo);
  const articleNumber = labeledValue(productInfo, ["상품 번호"]).replace(/-Server Region$/i, "").trim();
  const spuId = labeledValue(productInfo, ["SPU_ID"]);
  const color = labeledValue(optionInfo, ["색상"]);
  const size = labeledValue(optionInfo, ["사이즈"]);
  const skuId = labeledValue(optionInfo, ["SKU_ID"]);
  const status = String(raw?.status || cells.find((cell) => /^(?:거래 성공|발송 대기|발송 완료|판매자 발송 완료|거래 실패)$/.test(cell.trim())) || "").trim();
  const deadlineText = firstLine(cells.find((cell) => /발송|마감|까지/.test(cell) && /202\d|:\d\d/.test(cell)) || "");
  const timelineText = firstLine(raw?.timeline || cells.find((cell) => /주문\s*체결|구매자\s*결제/.test(cell)) || "");
  const priceText = String(raw?.priceText || "");
  const incomeText = String(raw?.incomeText || "");
  return {
    orderNumber,
    productName: productName.slice(0, 120),
    articleNumber: articleNumber.slice(0, 60),
    spuId: spuId.slice(0, 40),
    imageUrl: String(raw?.imageUrl || ""),
    color: color.slice(0, 60),
    size: size.slice(0, 60),
    skuId: skuId.slice(0, 60),
    status,
    statusKey: watchStatusKey(status),
    deadlineText: deadlineText.slice(0, 120),
    timelineText: timelineText.slice(0, 200),
    priceText: priceText.slice(0, 60),
    incomeText: incomeText.slice(0, 60),
  };
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

// List-level collection of the order management page. Reads tab counts and
// every row of every status tab without opening detail drawers.
export async function collectPoizonOrderWatchSnapshot(webContents, { onProgress = () => {} } = {}) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const evaluate = (fn, arg) => webContents.mainFrame.executeJavaScript(
    `(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`, true);
  const until = async (fn, { timeout = 20000, interval = 500 } = {}) => {
    const stop = Date.now() + timeout;
    for (;;) {
      const result = await fn().catch(() => null);
      if (result) return result;
      if (Date.now() > stop || webContents.isDestroyed()) throw new Error("POIZON_ORDER_WATCH_NOT_READY");
      await pause(interval);
    }
  };
  const readState = () => ({
    url: String(location.href || ""),
    text: String(document.body?.innerText || "").slice(0, 20000),
    passwordInput: Boolean(document.querySelector('input[type="password"],input[autocomplete="current-password"]')),
    tabs: [...document.querySelectorAll('[class*="global-text-label-wrap"]')].map((node) => node.innerText.trim()).filter(Boolean),
    selectedTab: [...document.querySelectorAll('[class*="global-text-label-wrap-selected"]')].map((node) => node.innerText.trim()).find(Boolean) || "",
    rows: [...document.querySelectorAll('tr.ant-table-row[data-row-key]')].map((node) => {
      const cells = [...node.querySelectorAll(':scope > td')].map((cell) => cell.innerText.trim());
      const image = node.querySelector('img');
      return {
        orderNumber: String(node.getAttribute('data-row-key') || ""),
        cells,
        imageUrl: image?.getAttribute('src') || image?.getAttribute('data-src') || '',
      };
    }),
    nextDisabled: document.querySelector('.ant-pagination-next')?.classList.contains('ant-pagination-disabled') ?? true,
    currentPage: document.querySelector('.ant-pagination-item-active')?.innerText.trim() || '',
    ready: document.readyState === "complete",
  });
  const problemOf = (state) => {
    if (/서비스 접속량이 많습니다|일시적인 트래픽 증가|access denied|too many requests/i.test(state.text)) return "POIZON_ACCESS_LIMITED";
    if (detectWatchPageProblem(state)) return "POIZON_LOGIN_REQUIRED";
    if (!state.url.startsWith("https://seller.poizon.com/")) return "POIZON_SELLER_PAGE_UNEXPECTED";
    return "";
  };
  const initial = await until(async () => {
    const state = await evaluate(readState);
    const problem = problemOf(state);
    if (problem) throw new Error(problem);
    return state.tabs.some((tab) => /^전체\s*\(\d+\)/.test(tab)) ? state : null;
  });
  const tabCounts = {};
  for (const tab of initial.tabs) {
    const match = tab.match(/^(.+?)\s*\((\d+)\)$/);
    if (match) tabCounts[match[1]] = Number(match[2]);
  }
  const rows = [];
  const seen = new Set();
  const targets = ORDER_WATCH_TABS.filter((tab) => tab.key !== "all");
  for (const target of targets) {
    const expected = Number.isFinite(tabCounts[target.label]) ? tabCounts[target.label] : null;
    await evaluate((label) => {
      const node = [...document.querySelectorAll('[class*="global-text-label-wrap"]')]
        .find((el) => el.innerText.trim().startsWith(`${label} (`));
      node?.click();
    }, target.label).catch(() => {});
    await pause(1500);
    let page = 0;
    for (;;) {
      const state = await until(async () => {
        const current = await evaluate(readState);
        const problem = problemOf(current);
        if (problem) throw new Error(problem);
        if (!current.selectedTab.startsWith(target.label) || !current.ready) return null;
        return current;
      });
      for (const row of state.rows) {
        if (!/^\d{10,25}$/.test(row.orderNumber) || seen.has(row.orderNumber)) continue;
        seen.add(row.orderNumber);
        rows.push({ ...row, tabLabel: target.label });
      }
      onProgress({ tab: target.label, tabKey: target.key, checked: rows.length, expected });
      page += 1;
      if (state.nextDisabled || page >= 30 || rows.length > 3000) break;
      await evaluate(() => document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)')?.click()).catch(() => {});
      await pause(1200);
    }
  }
  return { tabCounts, rows, scanned: rows.length };
}
