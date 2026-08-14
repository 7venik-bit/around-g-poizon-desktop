import {
  queryByArticleNumber,
  queryBrandInfo,
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
  if (/401|unauthorized|signature|sign/i.test(raw)) {
    return { code: "POIZON_AUTH_FAILED", message: "POIZON 인증 또는 서명 검증에 실패했습니다.", detail: raw, retryable: false };
  }
  if (/403|forbidden|permission/i.test(raw)) {
    return { code: "POIZON_PERMISSION_REQUIRED", message: "현재 App Key에 브랜드 조회 API 권한이 없습니다.", detail: raw, retryable: false };
  }
  return { code: "POIZON_FAILED", message: `POIZON 조회에 실패했습니다. (${raw})`, detail: raw, retryable: false };
}

function productImage(value, depth = 0) {
  if (!value || depth > 3) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = productImage(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const key of ["logoUrl", "imageUrl", "mainImageUrl", "spuLogo", "logo", "image", "images", "picUrl"]) {
    const found = productImage(value[key], depth + 1);
    if (found) return found;
  }
  return "";
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

export function brandPageCount(total, reportedPages, pageSize = 100) {
  return Math.min(
    Math.max(Number(reportedPages || 0), Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize) || 100)), 1),
    10_000,
  );
}

export async function discoverBrandCatalog(config, {
  maximumBrandId = 5_000,
  onProgress,
} = {}) {
  if (!config.appKey || !config.appSecret) {
    return { ok: false, error: { code: "CONFIG_REQUIRED", message: "POIZON App Key와 App Secret을 먼저 저장하세요." } };
  }
  const ids = Array.from({ length: maximumBrandId }, (_value, index) => index + 1);
  const batches = [];
  for (let index = 0; index < ids.length; index += 50) batches.push(ids.slice(index, index + 50));
  const brands = new Map(BRAND_CATALOG.map((brand) => [Number(brand.id), brand]));
  let successfulBatchCount = 0;
  let firstError = null;
  for (let index = 0; index < batches.length; index += 1) {
    try {
      const data = await queryBrandInfo({
        ...config,
        brandIds: batches[index],
        language: "ko",
        timeZone: "Asia/Seoul",
      });
      const rows = Array.isArray(data) ? data : data?.contents || data?.list || [];
      for (const row of rows) {
        const id = Number(row?.id || row?.brandId);
        const name = String(row?.name || row?.brandName || "").trim();
        if (!Number.isSafeInteger(id) || id < 1 || !name) continue;
        const english = String(row?.englishName || row?.nameEn || name).trim();
        brands.set(id, {
          id,
          name: english,
          ko: name,
          logoUrl: String(row?.logoUrl || ""),
        });
      }
      successfulBatchCount += 1;
    } catch (error) {
      firstError ||= error;
      const raw = error instanceof Error ? error.message : String(error);
      if (/400010007|401|403|unauthorized|forbidden|signature/i.test(raw)) {
        return { ok: false, error: friendlyError(error) };
      }
    }
    onProgress?.({
      percent: Math.round(((index + 1) / batches.length) * 100),
      completed: index + 1,
      total: batches.length,
      count: brands.size,
    });
  }
  if (!successfulBatchCount) {
    return { ok: false, error: friendlyError(firstError || new Error("BRAND_API_NO_SUCCESSFUL_RESPONSE")) };
  }
  return {
    ok: true,
    brands: [...brands.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "ko", { sensitivity: "base" })
    ),
    failedBatchCount: batches.length - successfulBatchCount,
  };
}

export function parsePopularProducts(input) {
  try {
    return { ok: true, products: parsePopularTable(input?.text) };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function resolvePopularProducts(config, input, { onProgress } = {}) {
  if (!config.appKey || !config.appSecret) {
    return { ok: false, error: { code: "CONFIG_REQUIRED", message: "POIZON App Key와 App Secret을 먼저 저장하세요." } };
  }
  let products;
  try {
    const limit = [10, 30, 50, 100, 200].includes(Number(input?.limit)) ? Number(input.limit) : 30;
    products = parsePopularTable(input?.text).slice(0, limit);
  } catch (error) {
    return { ok: false, error: { code: "POPULAR_TABLE_INVALID", message: "판매자센터 표의 헤더와 상품 행을 함께 넣어 주세요.", detail: error.message } };
  }

  const resolved = new Array(products.length);
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    if (!product.articleNumber) {
      resolved[index] = { ...product, apiMatched: false, apiError: "ARTICLE_NUMBER_NOT_FOUND" };
      continue;
    }
    let retryCount = 0;
    while (retryCount < 2) {
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
          logoUrl: productImage(match),
          brandName: match.brandName || match.brand || "",
          apiTitle: match.title || match.name || match.spuName || "",
        };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        retryCount += 1;
        if (message.includes("400010007") && retryCount < 2) {
          await wait(3_000);
          continue;
        }
        resolved[index] = { ...product, apiMatched: false, apiError: message };
      }
    }
    onProgress?.({
      completed: index + 1,
      total: products.length,
      matched: resolved.filter((item) => item?.apiMatched).length,
    });
    if (index < products.length - 1) await wait(1_050);
  }
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
      accessToken: config.accessToken || "",
      pageNum: input.pageNum || 1,
      pageSize: 100,
      apiBaseUrl: config.apiBaseUrl,
      timeZone: "Asia/Seoul",
      // Category labels must be requested in Korean because the UI groups by
      // Korean category names. The classifier still accepts English fields as
      // a fallback for mixed-language POIZON responses.
      language: input.mode === "category" ? "ko" : "en",
    };
    const brandIds = input.mode === "category"
      ? [...new Set((Array.isArray(input.brandIds) ? input.brandIds : [])
        .map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))].slice(0, 200)
      : [Number(input.brandId)];
    if (input.mode === "category" && !brandIds.length) {
      return {
        ok: false,
        error: {
          code: "SALES_RANKED_BRANDS_REQUIRED",
          message: "판매순위 상위 200건에서 연관 브랜드를 찾지 못했습니다. 판매순위 데이터를 먼저 가져와 주세요.",
          retryable: false,
        },
      };
    }
    let responses;
    if (input.mode === "category") {
      responses = [];
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      for (let brandIndex = 0; brandIndex < brandIds.length; brandIndex += 1) {
        const brandId = brandIds[brandIndex];
        const brandPages = [];
        let firstError = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            const first = await queryByBrandId({ ...common, pageNum: 1, brandIds: [brandId] });
            brandPages.push(first);
            const total = Number(first?.total || first?.totalCount || first?.count || 0);
            const pages = brandPageCount(total, first?.pages || first?.pageCount, common.pageSize);
            for (let pageNum = 2; pageNum <= pages; pageNum += 1) {
              brandPages.push(await queryByBrandId({ ...common, pageNum, brandIds: [brandId] }));
              await wait(250);
            }
            firstError = null;
            break;
          } catch (error) {
            firstError = error;
            brandPages.length = 0;
            if (attempt < 2) await wait(1_500);
          }
        }
        responses.push(firstError
          ? { status: "rejected", reason: firstError }
          : { status: "fulfilled", value: brandPages });
        input.onProgress?.(brandIndex + 1, brandIds.length);
        if (brandIndex < brandIds.length - 1) await wait(500);
      }
    } else {
      try {
        responses = [{ status: "fulfilled", value: await queryByBrandId({ ...common, brandIds }) }];
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (common.accessToken && /400010007|401|unauthorized|token|signature|sign/i.test(raw)) {
          common.accessToken = "";
          responses = [{ status: "fulfilled", value: await queryByBrandId({ ...common, brandIds }) }];
        } else {
          throw error;
        }
      }
    }
    if (input.mode === "brand" && input.allPages) {
      const first = responses[0]?.value;
      const responseTotal = Number(first?.total || first?.totalCount || first?.count || 0);
      const pageCount = brandPageCount(
        responseTotal,
        first?.pages || first?.pageCount,
        common.pageSize,
      );
      for (let pageNum = 2; pageNum <= pageCount; pageNum += 1) {
        responses.push({
          status: "fulfilled",
          value: await queryByBrandId({ ...common, pageNum, brandIds }),
        });
        input.onProgress?.(pageNum, pageCount);
      }
    }
    const successfulBrands = responses.filter((response) => response.status === "fulfilled");
    const successful = successfulBrands.flatMap((response) =>
      input.mode === "category" ? response.value : [response.value]);
    if (!successful.length) throw responses[0]?.reason || new Error("POIZON_FAILED");
    const uniqueProducts = new Map();
    for (const product of successful.flatMap((data) => normalizeBrandResult(data))) {
      const key = `${product.articleNumber || ""}:${product.globalSpuId || product.spuId || product.id || ""}`;
      if (!uniqueProducts.has(key)) uniqueProducts.set(key, product);
    }
    let products = [...uniqueProducts.values()];
    if (input.mode === "category" && input.category && input.category !== "전체") {
      products = products.filter((product) => product.categoryGroup === input.category);
    }
    const salesDataCount = products.filter((product) => product.hasSalesData).length;
    const salesFilterApplied = Boolean(input.minimumSales30 && salesDataCount > 0);
    if (salesFilterApplied) {
      products = products.filter((product) => product.hasSalesData && product.sales30d >= 30);
    }
    return {
      ok: true,
      products,
      total: products.length,
      sourceTotal: input.mode === "brand"
        ? Number(successful[0]?.total || products.length)
        : successfulBrands.reduce((sum, response) => {
          const firstPage = response.value?.[0];
          return sum + Number(firstPage?.total || firstPage?.totalCount || 0);
        }, 0) || products.length,
      pages: Math.max(...successful.map((data) => Number(data?.pages || 1))),
      pageNum: input.pageNum ?? 1,
      salesFilterAvailable: salesDataCount > 0,
      salesFilterApplied,
      salesDataCount,
      sourceCount: input.mode === "category" ? successfulBrands.length : successful.length,
      failedSourceCount: responses.length - successfulBrands.length,
      rankedBrandCount: Number(input.rankedBrandCount || brandIds.length),
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
