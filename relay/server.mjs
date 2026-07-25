import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { queryDomesticProducts } from "./domestic-search.mjs";

const host = process.env.RELAY_HOST || "127.0.0.1";
const port = Number(process.env.RELAY_PORT || 8787);
const relaySecret = process.env.RELAY_SHARED_SECRET || "";
const appKey = process.env.POIZON_APP_KEY || "";
const appSecret = process.env.POIZON_APP_SECRET || "";
const accessToken = process.env.POIZON_ACCESS_TOKEN || "";
const signerModule = process.env.POIZON_SIGNER_MODULE || "";
const apiBaseUrl = process.env.POIZON_API_BASE_URL || "https://open.poizon.com";
const timeZone = process.env.POIZON_TIME_ZONE || "Asia/Seoul";

let adapter = null;
let adapterError = "";
if (signerModule) {
  try {
    adapter = await import(pathToFileURL(resolve(process.cwd(), signerModule)).href);
  } catch (error) {
    adapterError = error instanceof Error ? error.message : "adapter-load-failed";
  }
}

const ready = Boolean(
  relaySecret &&
  appKey &&
  appSecret &&
  adapter &&
  typeof adapter.queryByArticleNumber === "function" &&
  typeof adapter.queryBySpuId === "function" &&
  typeof adapter.queryByBrandId === "function" &&
  typeof adapter.queryOrderList === "function",
);

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function upstreamFailure(response, error, fallbackMessage) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  console.error(`POIZON upstream request failed: ${message}`);
  return json(response, 424, {
    ok: false,
    code: "POIZON_UPSTREAM_FAILED",
    message,
  });
}

function authorized(request) {
  const candidate = request.headers["x-around-g-proxy-key"];
  if (!relaySecret || typeof candidate !== "string") return false;
  const expectedBuffer = Buffer.from(relaySecret);
  const candidateBuffer = Buffer.from(candidate);
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  if (!authorized(request)) return json(response, 401, { ok: false, code: "UNAUTHORIZED" });

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      ready,
      adapterLoaded: Boolean(adapter),
      adapterError: adapterError ? "adapter-load-failed" : "",
      capabilities: ready ? ["article-number", "spu-id", "brand-products", "domestic-products", "order-list"] : [],
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/query/article-number") {
    if (!ready) {
      return json(response, 503, {
        ok: false,
        code: "POIZON_SIGNER_NOT_CONFIGURED",
        message: "포이즌 공식 API 서명 어댑터가 아직 설정되지 않았습니다.",
      });
    }
    try {
      const input = await readBody(request);
      const articleNumber = String(input.articleNumber || "").trim();
      if (!articleNumber) return json(response, 400, { ok: false, code: "ARTICLE_NUMBER_REQUIRED" });
      const data = await adapter.queryByArticleNumber({
        appKey,
        appSecret,
        articleNumber,
        language: input.language || "ko",
        region: input.region || "KR",
        pageNum: Number(input.pageNum || 1),
        pageSize: Number(input.pageSize || 20),
        timeZone,
        apiBaseUrl,
      });
      return json(response, 200, { ok: true, data });
    } catch (error) {
      return upstreamFailure(response, error, "포이즌 API 호출에 실패했습니다.");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/query/spu-id") {
    if (!ready) {
      return json(response, 503, {
        ok: false,
        code: "POIZON_SIGNER_NOT_CONFIGURED",
        message: "포이즌 공식 API 서명 어댑터가 아직 설정되지 않았습니다.",
      });
    }
    try {
      const input = await readBody(request);
      const spuId = String(input.spuId || "").trim();
      if (!spuId) return json(response, 400, { ok: false, code: "SPU_ID_REQUIRED" });
      const data = await adapter.queryBySpuId({
        appKey,
        appSecret,
        spuId,
        language: input.language || "ko",
        region: input.region || "KR",
        timeZone,
        apiBaseUrl,
      });
      return json(response, 200, { ok: true, data });
    } catch (error) {
      return upstreamFailure(response, error, "포이즌 SPU ID API 호출에 실패했습니다.");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/query/brand-products") {
    if (!ready) {
      return json(response, 503, {
        ok: false,
        code: "POIZON_SIGNER_NOT_CONFIGURED",
        message: "포이즌 공식 API 서명 어댑터가 아직 설정되지 않았습니다.",
      });
    }
    try {
      const input = await readBody(request);
      const brandIds = Array.isArray(input.brandIds) ? input.brandIds : [input.brandId];
      if (!brandIds.some((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
        return json(response, 400, { ok: false, code: "BRAND_ID_REQUIRED" });
      }
      const data = await adapter.queryByBrandId({
        appKey,
        appSecret,
        brandIds,
        language: input.language || "ko",
        region: input.region || "KR",
        pageNum: Number(input.pageNum || 1),
        pageSize: Number(input.pageSize || 20),
        timeZone,
        apiBaseUrl,
      });
      return json(response, 200, { ok: true, data });
    } catch (error) {
      return upstreamFailure(response, error, "포이즌 브랜드 상품 API 호출에 실패했습니다.");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/query/domestic-products") {
    try {
      const input = await readBody(request);
      const query = String(input.query || "").trim();
      if (!query) return json(response, 400, { ok: false, code: "DOMESTIC_QUERY_REQUIRED" });
      const data = await queryDomesticProducts({ query });
      return json(response, 200, { ok: true, data });
    } catch (error) {
      return upstreamFailure(response, error, "국내 쇼핑몰 상품 조회에 실패했습니다.");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/orders/list") {
    if (!ready) {
      return json(response, 503, {
        ok: false,
        code: "POIZON_SIGNER_NOT_CONFIGURED",
        message: "포이즌 공식 API 서명 어댑터가 아직 설정되지 않았습니다.",
      });
    }
    try {
      const input = await readBody(request);
      const data = await adapter.queryOrderList({
        appKey,
        appSecret,
        accessToken,
        orderNo: input.orderNo,
        orderType: input.orderType,
        expressNo: input.expressNo,
        orderStatus: input.orderStatus,
        startCreated: input.startCreated,
        endCreated: input.endCreated,
        skuId: input.skuId,
        spuId: input.spuId,
        warehouseCode: input.warehouseCode,
        orderByCreateTimeDesc: input.orderByCreateTimeDesc !== false,
        confirmOrderStatus: input.confirmOrderStatus,
        pageNo: input.pageNo,
        pageSize: input.pageSize,
        orderBySpu: input.orderBySpu,
        language: input.language || "ko",
        timeZone,
        apiBaseUrl,
      });
      return json(response, 200, { ok: true, data });
    } catch (error) {
      return upstreamFailure(response, error, "포이즌 주문 API 호출에 실패했습니다.");
    }
  }

  return json(response, 404, { ok: false, code: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(`Around G POIZON relay listening on http://${host}:${port}`);
  console.log(ready ? "POIZON adapter ready" : "POIZON adapter not ready");
});
