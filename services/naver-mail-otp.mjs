// Naver mailbox one-time-code reader for the login verification step.
//
// Naver asks for an email verification code on unfamiliar devices. When the
// login page shows that step and the user saved a Naver mail app password
// (not the login password), the program fetches the newest verification mail
// over IMAP, fills the code once, and otherwise leaves the visible window
// for manual entry. Single shot only: a wrong code is never resubmitted, so
// automated guessing can never lock the account.
import tls from "node:tls";

export const NAVER_IMAP_HOST = "imap.naver.com";
export const NAVER_IMAP_PORT = 993;

// Exactly six digits next to a verification keyword. Surrounding text may be
// base64/quoted-printable decoded already; digits survive both encodings.
export function extractNaverOtpCode(text = "") {
  const body = String(text || "");
  if (!body) return "";
  const keyword = /인증|확인|보안|verify|verification|certif|code|otp/i;
  const digits = /(?<!\d)\d{6}(?!\d)/g;
  let match = null;
  let fallback = "";
  while ((match = digits.exec(body)) !== null) {
    const window = body.slice(Math.max(0, match.index - 60), match.index + 66);
    if (keyword.test(window)) return match[0];
    if (!fallback) fallback = match[0];
  }
  // A lone six-digit run with no keyword nearby is not evidence: report it
  // only when the whole text is short enough to be the code itself.
  if (fallback && body.trim().length <= 24) return fallback;
  return "";
}

export function decodeRfc2047Text(value = "") {
  return String(value || "").replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset, encoding, text) => {
    try {
      if (/^b$/i.test(encoding)) {
        return Buffer.from(String(text || ""), "base64").toString("utf-8");
      }
      const qp = String(text || "").replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(qp, "binary").toString("utf-8");
    } catch {
      return whole;
    }
  });
}

export function decodeMailBody(text = "", transferEncoding = "") {
  const raw = String(text || "");
  if (/base64/i.test(String(transferEncoding || ""))) {
    try {
      return Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf-8");
    } catch {
      return raw;
    }
  }
  if (/quoted-printable/i.test(String(transferEncoding || ""))) {
    try {
      const qp = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(qp, "binary").toString("utf-8");
    } catch {
      return raw;
    }
  }
  return raw;
}

function imapDate(date = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  return `${day}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function parseUidList(line = "") {
  const found = [];
  const match = /(?:UID )?SEARCH([\d ]*)/i.exec(String(line || ""));
  if (!match) return found;
  for (const part of match[1].trim().split(/\s+/)) {
    const uid = Number(part);
    if (Number.isFinite(uid) && uid > 0) found.push(uid);
  }
  return found;
}

function parseHeaderFields(block = "") {
  const text = String(block || "");
  const field = (name) => {
    const match = new RegExp(`^${name}:\\s*(.*)$`, "im").exec(text);
    return match ? decodeRfc2047Text(match[1].trim()) : "";
  };
  return {
    from: field("From"),
    subject: field("Subject"),
    date: field("Date"),
    transferEncoding: field("Content-Transfer-Encoding"),
  };
}

function headerLooksLikeOtpMail({ from = "", subject = "" } = {}) {
  const haystack = `${from} ${subject}`;
  if (/naver/i.test(from)) return true;
  return /인증|확인|보안|verify|verification|certif|otp|code/i.test(haystack);
}

// Visible email-verification code controls on a Naver login page. Returns
// screen points for the code input and its submit button, or null. Never
// matches the id/password form: when a password field is still visible this
// is not the verification step.
export const NAVER_OTP_INPUT_SCRIPT = `(() => {
  const visible = (el) => {
    if (!el || el.disabled) return false;
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const point = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  };
  const describe = (el) => [el.id, el.name, el.placeholder, el.autocomplete, el.getAttribute("aria-label"), el.maxLength].join(" ");
  const inputs = [...document.querySelectorAll("input")].filter(visible);
  if (inputs.some((el) => el.type === "password")) return null;
  const otp = inputs.find((el) => el.type !== "password"
    && /인증\s*번호|인증\s*코드|확인\s*번호|otp|verification.?code|auth.?code|인증|확인/i.test(describe(el)));
  if (!otp) return null;
  const submit = [...document.querySelectorAll("button,input[type=\\"submit\\"],[role=\\"button\\"]")].filter(visible)
    .find((el) => /인증|확인|제출|verify|confirm|submit/i.test([el.textContent, el.value, el.getAttribute("aria-label")].join(" ")));
  if (!submit) return null;
  return { otp: point(otp), submit: point(submit) };
})()`;

// Default byte transport over implicit TLS. Resolves with the buffered
// server text once the tagged completion line arrives.
export function createTlsImapTransport({ host = NAVER_IMAP_HOST, port = NAVER_IMAP_PORT, timeoutMs = 30000 } = {}) {
  let socket = null;
  let buffer = "";
  let failed = null;
  const ready = new Promise((resolve, reject) => {
    try {
      socket = tls.connect(
        { host, port: Number(port) || NAVER_IMAP_PORT, servername: host, rejectUnauthorized: true, timeout: Math.max(5000, Number(timeoutMs) || 30000) },
        () => resolve(),
      );
    } catch (error) {
      reject(error);
      return;
    }
    socket.setEncoding("utf-8");
    socket.on("data", (chunk) => { buffer += String(chunk || ""); });
    socket.on("error", (error) => { failed = error; });
    socket.on("timeout", () => { failed = failed || new Error("IMAP_TIMEOUT"); try { socket.destroy(); } catch {} });
  });
  return {
    async send(line) {
      await ready;
      if (failed) throw failed;
      await new Promise((resolve, reject) => {
        socket.write(String(line || ""), (error) => (error ? reject(error) : resolve()));
      });
    },
    async readUntil(pattern) {
      const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 30000);
      for (;;) {
        const at = buffer.search(pattern);
        if (at >= 0) {
          const out = buffer.slice(0, at);
          buffer = buffer.slice(at);
          return out;
        }
        if (failed) throw failed;
        if (socket.destroyed) throw new Error("IMAP_CLOSED");
        if (Date.now() >= deadline) throw new Error("IMAP_TIMEOUT");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async close() {
      try { socket?.destroy(); } catch {}
    },
  };
}

// Minimal IMAP client over an injected byte transport. Tests inject a
// scripted fake; production uses the TLS transport above. The app password
// travels only inside the LOGIN command and never appears in errors.
export async function fetchNaverOtpCode({
  user = "",
  appPassword = "",
  sinceMs = 0,
  timeoutMs = 240000,
  pollIntervalMs = 20000,
  maxCandidates = 5,
  host = NAVER_IMAP_HOST,
  port = NAVER_IMAP_PORT,
  connectImpl = null,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowImpl = () => Date.now(),
} = {}) {
  const loginId = String(user || "").trim();
  if (!loginId || !appPassword) return { ok: false, code: "MAIL_CREDENTIALS_REQUIRED" };
  const connect = typeof connectImpl === "function"
    ? connectImpl
    : ({ host: defaultHost, port: defaultPort } = {}) => createTlsImapTransport({ host: defaultHost, port: defaultPort });
  const deadline = nowImpl() + Math.max(10_000, Number(timeoutMs) || 240000);
  const seenUids = new Set();
  let connection = null;
  try {
    connection = await connect({ host, port });
    const send = async (tag, command) => connection.send(`${tag} ${command}\r\n`);
    const readTagged = (tag) => connection.readUntil(new RegExp(`^${tag} (OK|NO|BAD)`, "im"));
    const greeting = await connection.readUntil(/^\* OK/im);
    if (!greeting) return { ok: false, code: "MAIL_CONNECT_FAILED" };
    await send("a001", `LOGIN "${loginId.replace(/"/g, "")}" {${Buffer.byteLength(String(appPassword))}}\r\n${appPassword}`);
    const login = await readTagged("a001");
    if (!/^a001 OK/im.test(login || "")) return { ok: false, code: "MAIL_AUTH_FAILED" };
    await send("a002", "SELECT INBOX");
    const selected = await readTagged("a002");
    if (!/^a002 OK/im.test(selected || "")) return { ok: false, code: "MAIL_MAILBOX_UNAVAILABLE" };
    while (nowImpl() < deadline) {
      await send("a003", `UID SEARCH UNSEEN SINCE ${imapDate(new Date(Math.max(0, Number(sinceMs) || 0)))}`);
      const searched = await readTagged("a003");
      const uids = parseUidList((searched || "").split(/\r?\n/).find((line) => /^\* SEARCH/i.test(line)) || "")
        .filter((uid) => !seenUids.has(uid)).slice(-1 * Math.max(1, Number(maxCandidates) || 5));
      for (const uid of uids.slice().reverse()) {
        seenUids.add(uid);
        await send("a004", `UID FETCH ${uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TRANSFER-ENCODING)]`);
        const headerText = await readTagged("a004");
        const header = parseHeaderFields(headerText || "");
        if (!headerLooksLikeOtpMail(header)) continue;
        const mailTime = Date.parse(header.date || "");
        if (Number.isFinite(mailTime) && mailTime < Number(sinceMs)) continue;
        await send("a005", `UID FETCH ${uid} BODY[TEXT]`);
        const bodyText = await readTagged("a005");
        const code = extractNaverOtpCode(decodeMailBody(bodyText || "", header.transferEncoding));
        if (code) return { ok: true, code };
      }
      if (nowImpl() >= deadline) break;
      await sleepImpl(Math.max(1000, Number(pollIntervalMs) || 20000));
    }
    return { ok: false, code: "MAIL_CODE_NOT_FOUND" };
  } catch {
    return { ok: false, code: "MAIL_CONNECT_FAILED" };
  } finally {
    try {
      await connection?.send?.("a999 LOGOUT\r\n");
    } catch {
      // Logout is best-effort; the socket closes below regardless.
    }
    try {
      await connection?.close?.();
    } catch {
      // Closing a failed transport must not hide the fetch outcome.
    }
  }
}
