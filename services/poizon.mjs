import {
  queryByArticleNumber,
  queryBySpuId,
  queryByBrandId
} from "../relay/poizon-adapter.mjs";
import { BRAND_CATALOG, CATEGORY_GROUPS, normalizeBrandResult, parsePopularTable } from "./explorer.mjs";

function friendlyError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("400010007")) {
    return {
      code: "POIZON_REQUEST_REJECTED",
      message: "POIZON이 요청을 거절했습니다. 앱 키 권한, 운영용 App Secret, 접근 토큰 및 API 사용 승인을 확인하세요.",
      detail: raw,
      retryable: false
    };
  }
  if (/timeout|abort/i.test(raw)) {
    return { code: "POIZON_TIMEOUT", message: "POIZON 응답 시간이 초과되었습니다.", detail: raw, retryable: true };
  }
  return { code: "POIZON_FAILED", message: "POIZON 조회에 실패했습니다.", detail: raw, retryable: false };
}

export async function queryPoizon(config, input) {
  const common = {
    appKey: config.appKey,
    appSecret: config.appSecret,
    accessToken: config.accessToken || "",
    apiBaseUrl: config.apiBaseUrl || "https://open.poizon.com",
    timeZone: "Asia/Seoul"
  };
  if (!common.appKey || !common.appSecret) {
    return { ok: false, error: { code: "CONFIG_REQUIRED", message: "POIZON App Key와 App Secret을 먼저 저장하세요.", retryable: false } };
  }
  try {
    const data = input.mode === "spu"
      ? await queryBySpuId({ ...common, spuId: input.value })
      : await queryByArticleNumber({ ...common, articleNumber: input.value });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export function explorerMetadata() {
  return { brands: BRAND_CATALOG, categories: CATEGORY_GROUPS };
}

export function parsePopularProducts(input) {
  try {
    return { ok: true, products: parsePopularTable(input?.text) };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function resolvePopularProducts(config, input) {
  if (!config.appKey || !config.appSecret) {
    return { ok: false, error: { code: "CONFIG_REQUIRED", message: "POIZON App Key와 App Secret을 먼저 저장하세요." } };
  }
  let products;
  try {
    products = parsePopularTable(input?.text).slice(0, 30);
  } catch (error) {
    return { ok: false, error: { code: "POPULAR_TABLE_INVALID", message: "판매자센터 표의 헤더와 상품 행을 함께 넣어 주세요.", detail: error.message } };
  }

  let cursor = 0;
  const resolved = new Array(products.length);
  const worker = async () => {
    while (cursor < products.length) {
      const index = cursor;
      cursor += 1;
      const product = products[index];
      if (!product.articleNumber) {
        resolved[index] = { ...product, apiMatched: false, apiError: "ARTICLE_NUMBER_NOT_FOUND" };
        continue;
      }
      try {
        const data = await queryByArticleNumber({
          appKey: config.appKey,
          appSecret: config.appSecret,
          articleNumber: product.articleNumber,
          apiBaseUrl: config.apiBaseUrl,
          timeZone: "Asia/Seoul",
        });
        const matches = Array.isArray(data) ? data : data?.contents || data?.list || [];
        const match = matches[0] || {};
        resolved[index] = {
          ...product,
          apiMatched: matches.length > 0,
          apiResultCount: matches.length,
          globalSpuId: match.globalSpuId || "",
          regionSpuId: match.regionSpuId || "",
          spuId: match.spuId || match.dwSpuId || "",
          skuIdList: match.skuIdList || [],
          brandId: match.brandId || "",
          categoryId: match.categoryId || "",
        };
      } catch (error) {
        resolved[index] = { ...product, apiMatched: false, apiError: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, products.length) }, () => worker()));
  return {
    ok: true,
    products: resolved,
    matchedCount: resolved.filter((product) => product.apiMatched).length,
    failedCount: resolved.filter((product) => !product.apiMatched).length,
  };
}

export async function queryExplorer(config, input) {
  if (!config.appKey || !config.appSecret) {
    return { ok: false, error: { code: "CONFIG_REQUIRED", message: "POIZON App Key와 App Secret을 먼저 저장하세요." } };
  }
  try {
    const common = {
      appKey: config.appKey,
      appSecret: config.appSecret,
      pageNum: input.pageNum || 1,
      pageSize: Math.min(Number(input.pageSize) || 30, 100),
      apiBaseUrl: config.apiBaseUrl,
      timeZone: "Asia/Seoul",
    };
    const brandIds = input.mode === "category" ? BRAND_CATALOG.map((brand) => brand.id) : [Number(input.brandId)];
    const responses = input.mode === "category"
      ? await Promise.allSettled(brandIds.map((brandId) => queryByBrandId({ ...common, brandIds: [brandId] })))
      : [{ status: "fulfilled", value: await queryByBrandId({ ...common, brandIds }) }];
    const successful = responses.filter((response) => response.status === "fulfilled").map((response) => response.value);
    if (!successful.length) throw responses[0]?.reason || new Error("POIZON_FAILED");
    let products = successful.flatMap((data) => normalizeBrandResult(data, input.salesByArticle || {}));
    if (input.mode === "category" && input.category && input.category !== "전체") {
      products = products.filter((product) => product.categoryGroup === input.category);
    }
    const salesDataCount = products.filter((product) => product.hasSalesData).length;
    if (input.minimumSales30) products = products.filter((product) => product.hasSalesData && product.sales30d >= 30);
    return {
      ok: true,
      products,
      total: successful.reduce((sum, data) => sum + Number(data?.total || 0), 0) || products.length,
      pages: Math.max(...successful.map((data) => Number(data?.pages || 1))),
      pageNum: input.pageNum ?? 1,
      salesFilterAvailable: salesDataCount > 0,
      sourceCount: successful.length,
      failedSourceCount: responses.length - successful.length,
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
