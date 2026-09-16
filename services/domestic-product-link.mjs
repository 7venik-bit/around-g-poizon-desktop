// Serializable predicate shared by browser capture and result analysis.
// A query-bearing URL is not product evidence: accessibility/menu anchors may
// inherit the current search URL and consequently contain the requested SKU.
export function isNonProductNavigationLink({url = '', href = '', title = '', baseUrl = '', inNavigation = false} = {}) {
  if (inNavigation || String(href || '').trim().startsWith('#')) return true;
  const label = String(title || '').replace(/\s+/g, ' ').trim();
  if (/^(?:(?:메인|본문|주요|주)\s*)?(?:콘텐츠|컨텐츠|본문)(?:\s*영역)?\s*(?:로|으로)?\s*(?:건너\s*뛰기|바로\s*가기)$|^skip\s+to\s+(?:main\s+)?content$/i.test(label)) return true;
  let target;
  try { target = new URL(String(url || href), baseUrl || undefined); } catch { return true; }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return true;
  // Match navigation routes, not product detail routes with an optional search
  // tracking parameter. Unfamiliar real product URLs remain eligible.
  if (/(?:^|\/)(?:search(?:[-_](?:show|refine|results?))?(?:\.(?:ecn|html?|aspx?|php|do|ssg))?|login(?:\.[a-z]+)?|account-login|nidlogin\.login)(?:\/|$)/i.test(target.pathname)) return true;
  if (baseUrl) {
    try {
      const current = new URL(baseUrl);
      if (current.origin === target.origin && current.pathname === target.pathname && current.search === target.search) return true;
    } catch { /* A missing/invalid page URL is not affirmative product evidence. */ }
  }
  return false;
}
