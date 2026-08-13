export const WEEKLY_SITE_HEALTH_DAY = 4; // Thursday 00:00 === Wednesday 24:00
export const WEEKLY_SITE_HEALTH_HOUR = 0;

export const SITE_HEALTH_TARGETS = Object.freeze([
  { id: "poizon-seller", name: "POIZON 판매자센터", url: "https://seller.poizon.com/main/goods/search" },
  { id: "poizon-kr", name: "POIZON 한국", url: "https://kr.poizon.com/brand/list" },
  { id: "naver", name: "네이버 쇼핑", url: "https://search.naver.com/search.naver?where=shopping&query=%EB%82%98%EC%9D%B4%ED%82%A4" },
  { id: "musinsa", name: "무신사", url: "https://www.musinsa.com/search/goods?keyword=%EB%82%98%EC%9D%B4%ED%82%A4" },
  { id: "ssg-department", name: "SSG 백화점", url: "https://department.ssg.com/search.ssg?query=%EB%82%98%EC%9D%B4%ED%82%A4" },
  { id: "ssg-outlet", name: "SSG 아울렛", url: "https://www.ssg.com/search.ssg?target=all&siteNo=7008&query=%EB%82%98%EC%9D%B4%ED%82%A4" },
  { id: "lotte-department", name: "롯데온 백화점", url: "https://www.lotteon.com/search/search/search.ecn?render=search&platform=pc&q=%EB%82%98%EC%9D%B4%ED%82%A4&mallFilter=%EB%B0%B1%ED%99%94%EC%A0%90" },
  { id: "lotte-outlet", name: "롯데온 아울렛", url: "https://www.lotteon.com/search/search/search.ecn?render=search&platform=pc&q=%EB%82%98%EC%9D%B4%ED%82%A4&mallFilter=%EC%95%84%EC%9A%B8%EB%A0%9B" },
  { id: "hyundai", name: "현대Hmall", url: "https://www.hmall.com/p/smSearch.do?searchTerm=%EB%82%98%EC%9D%B4%ED%82%A4" },
]);

export function nextWeeklySiteHealthAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(WEEKLY_SITE_HEALTH_HOUR, 0, 0, 0);
  const daysUntil = (WEEKLY_SITE_HEALTH_DAY - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + daysUntil);
  if (next <= now) next.setDate(next.getDate() + 7);
  return next;
}

export function weeklySiteHealthSummary(results = []) {
  const failed = results.filter((result) => !result.ok);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failedNames: failed.map((result) => result.name),
    ok: results.length > 0 && failed.length === 0,
  };
}
