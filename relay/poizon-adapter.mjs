import { createHash } from "node:crypto";

export const POIZON_API_BASE_URL = "https://open.poizon.com";
export const ARTICLE_NUMBER_PATH =
  "/dop/api/v1/pop/api/v1/intl-commodity/intl/spu/spu-basic-info/by-article-number";
export const SPU_ID_PATH =
  "/dop/api/v1/pop/api/v1/intl-commodity/intl/spu/spu-basic-info/by-spu";
export const BRAND_PRODUCTS_PATH =
  "/dop/api/v1/pop/api/v1/intl-commodity/intl/spu/spu-basic-info/by-brandId";
export const ORDER_LIST_PATH = "/dop/api/v1/pop/api/v1/order/generic_list";

const ORDER_TYPES = new Set(["NORMAL_SALE", "CONSIGN", "PRE_SALE", "DIRECT"]);
const API_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function signValue(value) {
  const replacer = (_key, nestedValue) => nestedValue === null ? undefined : nestedValue;

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === null || item === undefined) return "null";
      if (typeof item === "object") return JSON.stringify(item, replacer);
      return String(item);
    }).join(",");
  }

  if (typeof value === "object") return JSON.stringify(value, replacer);
  return String(value);
}

function formEncode(value) {
  return encodeURIComponent(value).replace(/%20/gi, "+");
}

export function createPoizonSignature(params, appSecret) {
  if (!appSecret) throw new Error("POIZON_APP_SECRET_REQUIRED");

  const preSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${formEncode(signValue(params[key]))}`)
    .join("&");

  return createHash("md5")
    .update(`${preSign}${appSecret}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function officialBaseUrl(value) {
  const url = new URL(value || POIZON_API_BASE_URL);
  if (url.protocol !== "https:") throw new Error("POIZON_API_HTTPS_REQUIRED");
  return url;
}

function formatApiDateTime(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function optionalString(value, maximum = 120) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw new Error("POIZON_PARAMETER_TOO_LONG");
  return normalized;
}

function optionalInteger(value, allowedValues) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || (allowedValues && !allowedValues.has(normalized))) {
    throw new Error("POIZON_PARAMETER_INVALID");
  }
  return normalized;
}

function apiDateTime(value, fallback) {
  const normalized = optionalString(value, 19) || fallback;
  if (!API_DATE_TIME_PATTERN.test(normalized)) throw new Error("POIZON_DATE_TIME_INVALID");
  return normalized;
}

async function postSignedRequest({
  path,
  requestBody,
  appSecret,
  apiBaseUrl,
  fetchImpl,
}) {
  requestBody.sign = createPoizonSignature(requestBody, appSecret);

  const endpoint = new URL(path, officialBaseUrl(apiBaseUrl));
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`POIZON_HTTP_${response.status}`);

  const responseCode = payload && typeof payload === "object" ? payload.code : undefined;
  if (responseCode !== undefined && String(responseCode) !== "200") {
    throw new Error(`POIZON_API_${String(responseCode).replace(/[^A-Za-z0-9_-]/g, "_")}`);
  }

  return payload?.data ?? payload;
}

export async function queryByArticleNumber({
  appKey,
  appSecret,
  articleNumber,
  language = "ko",
  region = "KR",
  pageNum = 1,
  pageSize = 20,
  timeZone = "Asia/Seoul",
  apiBaseUrl = POIZON_API_BASE_URL,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!appKey) throw new Error("POIZON_APP_KEY_REQUIRED");

  const normalizedArticleNumber = String(articleNumber || "").trim();
  if (!normalizedArticleNumber) throw new Error("ARTICLE_NUMBER_REQUIRED");
  if (normalizedArticleNumber.length > 120) throw new Error("ARTICLE_NUMBER_TOO_LONG");

  const requestBody = {
    app_key: appKey,
    articleNumber: normalizedArticleNumber,
    language,
    pageNum: positiveInteger(pageNum, 1, 10_000),
    pageSize: positiveInteger(pageSize, 20, 100),
    region,
    timeZone,
    timestamp: Number(now()),
  };

  return postSignedRequest({
    path: ARTICLE_NUMBER_PATH,
    requestBody,
    appSecret,
    apiBaseUrl,
    fetchImpl,
  });
}

export async function queryBySpuId({
  appKey,
  appSecret,
  spuId,
  language = "ko",
  region = "KR",
  timeZone = "Asia/Seoul",
  apiBaseUrl = POIZON_API_BASE_URL,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!appKey) throw new Error("POIZON_APP_KEY_REQUIRED");

  const normalizedSpuId = String(spuId || "").trim();
  if (!normalizedSpuId) throw new Error("SPU_ID_REQUIRED");
  if (!/^\d{1,16}$/.test(normalizedSpuId)) throw new Error("SPU_ID_INVALID");
  const numericSpuId = Number(normalizedSpuId);
  if (!Number.isSafeInteger(numericSpuId) || numericSpuId < 1) throw new Error("SPU_ID_INVALID");

  const requestBody = {
    app_key: appKey,
    spuIds: [numericSpuId],
    sellerStatusEnable: false,
    buyStatusEnable: false,
    language,
    region,
    timeZone,
    timestamp: Number(now()),
  };

  return postSignedRequest({
    path: SPU_ID_PATH,
    requestBody,
    appSecret,
    apiBaseUrl,
    fetchImpl,
  });
}

export async function queryByBrandId({
  appKey,
  appSecret,
  brandIds,
  language = "ko",
  region = "KR",
  pageNum = 1,
  pageSize = 20,
  timeZone = "Asia/Seoul",
  apiBaseUrl = POIZON_API_BASE_URL,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!appKey) throw new Error("POIZON_APP_KEY_REQUIRED");

  const normalizedBrandIds = [...new Set((Array.isArray(brandIds) ? brandIds : [brandIds])
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))]
    .slice(0, 20);
  if (!normalizedBrandIds.length) throw new Error("POIZON_BRAND_ID_REQUIRED");

  const requestBody = {
    app_key: appKey,
    brandIdList: normalizedBrandIds,
    language,
    pageNum: positiveInteger(pageNum, 1, 10_000),
    pageSize: positiveInteger(pageSize, 20, 100),
    region,
    timeZone,
    timestamp: Number(now()),
  };

  return postSignedRequest({
    path: BRAND_PRODUCTS_PATH,
    requestBody,
    appSecret,
    apiBaseUrl,
    fetchImpl,
  });
}

export async function queryOrderList({
  appKey,
  appSecret,
  accessToken,
  orderNo,
  orderType,
  expressNo,
  orderStatus,
  startCreated,
  endCreated,
  skuId,
  spuId,
  warehouseCode,
  orderByCreateTimeDesc = true,
  confirmOrderStatus,
  pageNo = 1,
  pageSize = 20,
  orderBySpu,
  language = "ko",
  timeZone = "Asia/Seoul",
  apiBaseUrl = POIZON_API_BASE_URL,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!appKey) throw new Error("POIZON_APP_KEY_REQUIRED");

  const normalizedOrderType = optionalString(orderType, 32);
  if (normalizedOrderType && !ORDER_TYPES.has(normalizedOrderType)) {
    throw new Error("POIZON_ORDER_TYPE_INVALID");
  }

  const nowValue = Number(now());
  const endFallback = formatApiDateTime(new Date(nowValue), timeZone);
  const startFallback = formatApiDateTime(new Date(nowValue - 7 * 24 * 60 * 60 * 1000), timeZone);

  const requestBody = {
    app_key: appKey,
    access_token: optionalString(accessToken, 512),
    order_no: optionalString(orderNo),
    order_type: normalizedOrderType,
    express_no: optionalString(expressNo),
    order_status: optionalInteger(orderStatus),
    start_created: apiDateTime(startCreated, startFallback),
    end_created: apiDateTime(endCreated, endFallback),
    sku_id: optionalString(skuId),
    spu_id: optionalString(spuId),
    warehouse_code: optionalString(warehouseCode),
    order_by_create_time_desc: Boolean(orderByCreateTimeDesc),
    confirmOrderStatus: optionalInteger(confirmOrderStatus, new Set([1, 2, 3])),
    page_no: positiveInteger(pageNo, 1, 10_000),
    page_size: positiveInteger(pageSize, 20, 100),
    order_by_spu: optionalInteger(orderBySpu, new Set([0, 1])),
    language,
    timeZone,
    timestamp: nowValue,
  };

  Object.keys(requestBody).forEach((key) => {
    if (requestBody[key] === undefined) delete requestBody[key];
  });

  return postSignedRequest({
    path: ORDER_LIST_PATH,
    requestBody,
    appSecret,
    apiBaseUrl,
    fetchImpl,
  });
}
