// Import browser cookies the operator explicitly pasted (for example an
// EditThisCookie / Cookie-Editor JSON export from their own logged-in Chrome)
// into the app's domestic search session. Only cookies scoped to the retailer's
// own domains are accepted; everything else is reported as rejected.
const MAX_COOKIES = 200;
const MAX_NAME_LENGTH = 4096;
const MAX_VALUE_LENGTH = 16384;

function normalizeDomain(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^\.+/, "");
}

function domainAllowed(domain, allowedDomains = []) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return (Array.isArray(allowedDomains) ? allowedDomains : [])
    .map(normalizeDomain)
    .filter(Boolean)
    .some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function sanitizeExpiration(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return Math.floor(timestamp);
}

export function parseBrowserCookieImport(text = "", allowedDomains = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch {
    return { cookies: [], rejected: 0, error: "COOKIE_JSON_INVALID" };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const cookies = [];
  let rejected = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      rejected += 1;
      continue;
    }
    const name = String(entry.name ?? "");
    const value = Object.hasOwn(entry, "value") ? String(entry.value ?? "") : null;
    const domain = normalizeDomain(entry.domain);
    if (!name || name.length > MAX_NAME_LENGTH || value === null || value.length > MAX_VALUE_LENGTH
      || !domainAllowed(domain, allowedDomains)) {
      rejected += 1;
      continue;
    }
    cookies.push({
      name,
      value,
      domain,
      path: String(entry.path || "/").slice(0, 256) || "/",
      secure: entry.secure !== false,
      httpOnly: entry.httpOnly === true,
      expirationDate: sanitizeExpiration(entry.expirationDate),
    });
    if (cookies.length >= MAX_COOKIES) break;
  }
  return { cookies, rejected, error: "" };
}
