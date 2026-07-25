import { queryByArticleNumber } from "../relay/poizon-adapter.mjs";
import { queryDomesticProducts } from "../relay/domestic-search.mjs";

const articleNumber = process.argv[2] || "DD1391-100";
const report = {
  checkedAt: new Date().toISOString(),
  articleNumber,
  poizon: { ok: false },
  domestic: { ok: false, sources: [] },
};

try {
  const data = await queryByArticleNumber({
    appKey: process.env.POIZON_APP_KEY,
    appSecret: process.env.POIZON_APP_SECRET,
    articleNumber,
    apiBaseUrl: process.env.POIZON_API_BASE_URL,
  });
  const rows = Array.isArray(data) ? data : data?.list || data?.records || data?.items || [];
  report.poizon = { ok: true, resultCount: Array.isArray(rows) ? rows.length : undefined };
} catch (error) {
  report.poizon = { ok: false, error: error instanceof Error ? error.message : String(error) };
}

try {
  const result = await queryDomesticProducts({ query: articleNumber });
  report.domestic = {
    ok: result.sources.some((source) => source.ok),
    productCount: result.products.length,
    sources: result.sources.map(({ store, ok, count }) => ({ store, ok, count })),
  };
} catch (error) {
  report.domestic = { ok: false, error: error instanceof Error ? error.message : String(error), sources: [] };
}

console.log(JSON.stringify(report, null, 2));
