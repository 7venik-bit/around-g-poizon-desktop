// Import browser cookies the operator explicitly pasted (a JSON export such as
// EditThisCookie / Cookie-Editor, or Netscape cookie.txt from Cookie Manager)
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

export function normalizeCookieEntry(entry, allowedDomains = []) {
  if (!entry || typeof entry !== "object") return null;
  const name = String(entry.name ?? "");
  const value = Object.hasOwn(entry, "value") ? String(entry.value ?? "") : null;
  const domain = normalizeDomain(entry.domain);
  if (!name || name.length > MAX_NAME_LENGTH || value === null || value.length > MAX_VALUE_LENGTH
    || !domainAllowed(domain, allowedDomains)) {
    return null;
  }
  return {
    name,
    value,
    domain,
    path: String(entry.path || "/").slice(0, 256) || "/",
    secure: entry.secure !== false,
    httpOnly: entry.httpOnly === true,
    expirationDate: sanitizeExpiration(entry.expirationDate),
  };
}

function collectEntries(entries, allowedDomains = []) {
  const cookies = [];
  let rejected = 0;
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    const cookie = normalizeCookieEntry(entry, allowedDomains);
    if (!cookie) {
      rejected += 1;
      continue;
    }
    cookies.push(cookie);
    if (cookies.length >= MAX_COOKIES) break;
  }
  return { cookies, rejected };
}

// Netscape cookie.txt: domain, tailmatch, path, secure, expires, name, value.
// A leading #HttpOnly marks the cookie http-only.
function parseNetscapeCookies(text = "", allowedDomains = []) {
  const entries = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly"))) continue;
    const httpOnly = trimmed.startsWith("#HttpOnly");
    const fields = (httpOnly ? trimmed.slice("#HttpOnly".length) : trimmed).split("\t");
    if (fields.length < 7) continue;
    const [domain, , path, secure, expires, name, ...valueParts] = fields;
    entries.push({
      domain,
      path,
      secure: String(secure).toUpperCase() === "TRUE",
      httpOnly,
      expirationDate: Number(expires) > 0 ? Number(expires) : undefined,
      name,
      value: valueParts.join("\t"),
    });
  }
  return collectEntries(entries, allowedDomains);
}

export function parseBrowserCookieImport(text = "", allowedDomains = []) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { cookies: [], rejected: 0, error: "COOKIE_EMPTY" };
  try {
    return { ...collectEntries(JSON.parse(raw), allowedDomains), error: "" };
  } catch {
    // Fall through to Netscape cookie.txt below.
  }
  if (raw.includes("\t")) {
    return { ...parseNetscapeCookies(raw, allowedDomains), error: "" };
  }
  return { cookies: [], rejected: 0, error: "COOKIE_JSON_INVALID" };
}
