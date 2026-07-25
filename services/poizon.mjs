import {
  queryByArticleNumber,
  queryBySpuId
} from "../relay/poizon-adapter.mjs";

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
