// External-Chrome retailer login: 외부 창 열기 → 로그인 → 상품 검색.
//
// The program never drives the user's own Chrome profile and never passes
// credentials on a command line. Instead it launches a dedicated, app-owned
// Chrome profile with remote debugging, performs the login visibly in that
// window (auto-filled from the program's saved account when available,
// manual otherwise), imports the resulting session cookies into the Electron
// search partition, then closes the external window and lets the normal
// search flow run. Every failure carries a fixed EXTERNAL_LOGIN_* code.

export const EXTERNAL_LOGIN_CODES = Object.freeze({
  CHROME_NOT_FOUND: "CHROME_NOT_FOUND",
  CHROME_LAUNCH_FAILED: "CHROME_LAUNCH_FAILED",
  CDP_UNREACHABLE: "CDP_UNREACHABLE",
  LOGIN_PAGE_UNREADABLE: "LOGIN_PAGE_UNREADABLE",
  LOGIN_BLOCKED: "LOGIN_BLOCKED",
  LOGIN_TIMEOUT: "LOGIN_TIMEOUT",
  LOGIN_CANCELED: "LOGIN_CANCELED",
});

const CODE_MESSAGES = Object.freeze({
  CHROME_NOT_FOUND: "Chrome을 찾지 못했습니다. Chrome 설치 후 다시 시도해 주세요.",
  CHROME_LAUNCH_FAILED: "외부 로그인 창을 실행하지 못했습니다.",
  CDP_UNREACHABLE: "외부 로그인 창에 연결하지 못했습니다.",
  LOGIN_PAGE_UNREADABLE: "로그인 화면을 인식하지 못했습니다. 열린 창에서 직접 로그인을 진행해 주세요.",
  LOGIN_BLOCKED: "판매처 보안 차단 화면입니다. 열린 창에서 직접 확인해 주세요.",
  LOGIN_TIMEOUT: "외부 로그인 제한 시간을 초과했습니다.",
  LOGIN_CANCELED: "외부 로그인이 중단되었습니다.",
});

export function externalLoginMessage(code) {
  return CODE_MESSAGES[String(code || "")] || "외부 로그인에 실패했습니다.";
}

export function externalLoginFailure(code) {
  const normalized = String(code || "");
  const known = Object.hasOwn(EXTERNAL_LOGIN_CODES, normalized) ? normalized : "LOGIN_TIMEOUT";
  return { ok: false, code: known, message: externalLoginMessage(known) };
}

export const CHROME_EXECUTABLE_CANDIDATES = Object.freeze([
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["ProgramFiles(x86)"] || ""}\\Google\\Chrome\\Application\\chrome.exe`,
]);

function chromeCandidatesForPlatform(platform) {
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  if (platform === "linux") {
    return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"];
  }
  return [...CHROME_EXECUTABLE_CANDIDATES];
}

export function findChromeExecutable({ existsSyncImpl, platformImpl } = {}) {
  const exists = typeof existsSyncImpl === "function" ? existsSyncImpl : () => false;
  const platform = platformImpl || process.platform;
  for (const candidate of chromeCandidatesForPlatform(platform)) {
    if (!candidate) continue;
    try {
      if (exists(candidate)) return candidate;
    } catch {
      // Ignore a broken existence probe and try the next candidate.
    }
  }
  return "";
}

export function chromeLoginArgs({ userDataDir = "", port = 0, url = "" } = {}) {
  return [
    `--remote-debugging-port=${Number(port) || 9222}`,
    `--user-data-dir=${String(userDataDir)}`,
    "--no-first-run",
    "--no-default-browser-check",
    // A killed window must never greet the next launch with a restore bubble.
    "--disable-session-crashed-bubble",
    "--disable-features=Translate",
    "--new-window",
    String(url || "about:blank"),
  ];
}

// A port answers /json/version only while a debugging Chrome owns it.
export async function isChromeResponsive({ fetchImpl = fetch, port = 0 } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${Number(port) || 9222}/json/version`);
    return response?.ok === true;
  } catch {
    return false;
  }
}

export function closeLoginChrome(child) {
  try {
    if (child && child.killed !== true && typeof child.kill === "function") child.kill();
  } catch {
    // The external window is best-effort cleanup only.
  }
}

export function tabHost(url = "") {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function listPageTargets({ fetchImpl = fetch, port = 0 } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${Number(port) || 9222}/json/list`);
  if (!response || response.ok !== true) throw new Error("CDP_HTTP_ERROR");
  const targets = await response.json();
  return (Array.isArray(targets) ? targets : [])
    .filter((entry) => entry && entry.type === "page");
}

export async function closePageTarget({ fetchImpl = fetch, port = 0, targetId = "" } = {}) {
  if (!targetId) return false;
  try {
    const response = await fetchImpl(
      `http://127.0.0.1:${Number(port) || 9222}/json/close/${encodeURIComponent(targetId)}`,
      { method: "PUT" },
    );
    return response?.ok === true;
  } catch {
    return false;
  }
}

// One tab per retailer inside its own window: reuse the retailer's tab
// when it already exists so repeated searches never spray blank tabs.
export function findRetailerTab(targets = [], loginUrl = "") {
  const host = tabHost(loginUrl);
  if (!host) return null;
  return (Array.isArray(targets) ? targets : []).find((entry) => entry?.id
    && entry?.webSocketDebuggerUrl && tabHost(entry.url) === host) || null;
}

export async function closeBlankTabs({ fetchImpl = fetch, port = 0 } = {}) {
  try {
    const targets = await listPageTargets({ fetchImpl, port });
    const blanks = targets.filter((entry) => entry?.id && entry?.webSocketDebuggerUrl
      && ["about:blank", ""].includes(String(entry.url || "")));
    // Never close the last remaining tab: Chrome would reopen a blank one.
    if (!blanks.length || blanks.length >= targets.length) return 0;
    let closed = 0;
    for (const blank of blanks) {
      if (await closePageTarget({ fetchImpl, port, targetId: blank.id })) closed += 1;
    }
    return closed;
  } catch {
    return 0;
  }
}

// A transient /json/list failure at the navigation deadline must not kill a
// tab that actually landed: re-list once and keep it when it reports an
// accepted host. Pure over fetchImpl so the rescue itself is unit-testable.
export async function relistLandedTab({ fetchImpl = fetch, port = 0, targetId = "", hostAccepted = () => false } = {}) {
  let targets = [];
  try {
    targets = await listPageTargets({ fetchImpl, port });
  } catch {
    return null;
  }
  const landed = (Array.isArray(targets) ? targets : []).find((entry) => entry.id === targetId);
  try {
    return landed && hostAccepted(landed.url) ? { targetId } : null;
  } catch {
    return null;
  }
}

export async function acquireLoginTab({
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
  port = 0,
  loginUrl = "",
  knownTabs = {},
  tabKey = "",
  // Merchant registrable domains (["ssg.com"]): the login entry may bounce
  // to another host of the same merchant (member.ssg.com → www.ssg.com).
  // Same-organization hosts are accepted; anything else never matches.
  allowedHostSuffixes = [],
  navigateTimeoutMs = 15000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  canceled = () => false,
} = {}) {
  const expectedHost = tabHost(loginUrl);
  if (!expectedHost) throw new Error("LOGIN_PAGE_UNREADABLE");
  const suffixes = [...new Set((Array.isArray(allowedHostSuffixes) ? allowedHostSuffixes : [])
    .map((domain) => String(domain || "").toLowerCase().replace(/^\./, "")).filter(Boolean))];
  const hostAccepted = (url = "") => {
    const host = tabHost(url);
    if (!host) return false;
    if (host === expectedHost) return true;
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  };
  let targets = [];
  try {
    targets = await listPageTargets({ fetchImpl, port });
  } catch {
    throw new Error("CDP_UNREACHABLE");
  }
  const knownId = tabKey && knownTabs ? knownTabs[tabKey] : "";
  let tab = (knownId && targets.find((entry) => entry.id === knownId && entry.webSocketDebuggerUrl))
    || (Array.isArray(targets) ? targets : []).find((entry) => entry?.id
      && entry?.webSocketDebuggerUrl && hostAccepted(entry.url)) || null;
  const reused = Boolean(tab);
  const client = () => createCdpPageClient({ fetchImpl, WebSocketImpl, port, targetId: tab?.id || null });
  try {
    if (!tab) {
      const created = await client().openTab(loginUrl);
      if (!created?.id) throw new Error("CDP_UNREACHABLE");
      tab = { id: created.id };
    }
    // /json/new?url= is ignored by some Chrome builds, so always navigate
    // explicitly: launching Chrome with the URL argument is the only path
    // proven to work everywhere.
    await client().navigate(loginUrl);
  } catch {
    throw new Error("CDP_UNREACHABLE");
  }
  const id = tab.id;
  const deadline = Date.now() + Math.max(3000, Number(navigateTimeoutMs) || 15000);
  const failWithUrl = (code) => {
    const error = new Error(code);
    try {
      const current = (Array.isArray(targets) ? targets : []).find((entry) => entry.id === id);
      if (current?.url) error.observedUrl = String(current.url);
    } catch {
      // The failing code is the contract; the URL is best-effort evidence.
    }
    throw error;
  };
  while (Date.now() < deadline) {
    if (canceled()) failWithUrl("LOGIN_CANCELED");
    try {
      targets = await listPageTargets({ fetchImpl, port });
    } catch {
      targets = [];
    }
    const current = targets.find((entry) => entry.id === id);
    if (current && hostAccepted(current.url)) return { targetId: id };
    await sleepImpl(1000);
  }
  // Never litter blank tabs: remove the tab this call created so the next
  // login check starts clean instead of piling up dead tabs. A transient
  // /json/list failure at the deadline must not kill a tab that actually
  // landed, so re-list once before declaring the page unreadable.
  const rescued = await relistLandedTab({ fetchImpl, port, targetId: id, hostAccepted: (url) => hostAccepted(url) });
  if (rescued) return rescued;
  if (!reused) {
    try {
      await closePageTarget({ fetchImpl, port, targetId: id });
    } catch {
      // Cleanup failure must not hide the navigation outcome.
    }
  }
  failWithUrl("LOGIN_PAGE_UNREADABLE");
}

// A port answers /json/version only while a debugging Chrome owns it.
export async function pickRemoteDebuggingPort({ fetchImpl = fetch, base = 9222, count = 11 } = {}) {
  for (let port = base; port < base + Math.max(1, Number(count) || 1); port += 1) {
    try {
      await fetchImpl(`http://127.0.0.1:${port}/json/version`);
    } catch {
      return port;
    }
  }
  return 0;
}

export function createCdpPageClient({
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
  port = 0,
  targetId = null,
  callTimeoutMs = 15000,
} = {}) {
  if (typeof WebSocketImpl !== "function") throw new Error("CDP_UNREACHABLE");
  const base = `http://127.0.0.1:${Number(port) || 9222}`;
  async function json(path, init) {
    const response = await fetchImpl(base + path, init);
    if (!response || response.ok !== true) throw new Error("CDP_HTTP_ERROR");
    return response.json();
  }
  async function pageTarget() {
    const targets = await json("/json/list");
    const pages = (Array.isArray(targets) ? targets : [])
      .filter((entry) => entry && entry.type === "page" && entry.webSocketDebuggerUrl);
    if (!pages.length) throw new Error("CDP_NO_PAGE_TARGET");
    return (targetId && pages.find((entry) => entry.id === targetId)) || pages[0];
  }
  async function openDebugger() {
    const page = await pageTarget();
    return { page, socket: new WebSocketImpl(page.webSocketDebuggerUrl) };
  }
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket = null;
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close();
        } catch {
          // Closing a failed socket must not hide the original outcome.
        }
        if (ok) resolve(value);
        else reject(value);
      };
      const timer = setTimeout(() => finish(false, new Error("CDP_CALL_TIMEOUT")), Math.max(1000, Number(callTimeoutMs) || 15000));
      Promise.resolve()
        .then(openDebugger)
        .then(({ socket: opened }) => {
          socket = opened;
          socket.addEventListener("open", () => {
            try {
              socket.send(JSON.stringify({ id: 1, method, params }));
            } catch (error) {
              finish(false, error);
            }
          });
          socket.addEventListener("message", (event) => {
            let payload = null;
            try {
              payload = JSON.parse(String(event?.data ?? ""));
            } catch {
              return;
            }
            if (!payload || payload.id !== 1) return;
            if (payload.error) finish(false, new Error(`CDP_${payload.error.message || "CALL_FAILED"}`));
            else finish(true, payload.result);
          });
          socket.addEventListener("error", () => finish(false, new Error("CDP_SOCKET_ERROR")));
          socket.addEventListener("close", () => finish(false, new Error("CDP_SOCKET_CLOSED")));
        })
        .catch((error) => finish(false, error));
    });
  }
  return {
    async openTab(url) {
      const created = await json(`/json/new?${new URLSearchParams({ url: String(url) })}`, { method: "PUT" });
      if (created && created.id) targetId = created.id;
      return created;
    },
    async evaluate(expression, awaitPromise = false) {
      const result = await call("Runtime.evaluate", {
        expression: String(expression),
        awaitPromise: Boolean(awaitPromise),
        returnByValue: true,
      });
      if (result?.exceptionDetails) throw new Error("CDP_EVALUATE_FAILED");
      return result?.result?.value;
    },
    async clickPoint(point) {
      const x = Math.round(Number(point?.x));
      const y = Math.round(Number(point?.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("CDP_BAD_POINT");
      // Hover first: the headed window visibly reacts before the click lands.
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (const type of ["mousePressed", "mouseReleased"]) {
        await call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      }
    },
    async getCookies() {
      const result = await call("Network.getAllCookies", {});
      return Array.isArray(result?.cookies) ? result.cookies : [];
    },
    async navigate(url) {
      await call("Page.navigate", { url: String(url) });
    },
  };
}

export const EXTERNAL_LOGIN_STATE_SCRIPT = `(() => {
  const body = document.body ? String(document.body.textContent || document.body.innerText || "") : "";
  const text = body.slice(0, 40000);
  const labels = [...document.querySelectorAll("a,button")].map((el) => String(el.textContent || el.innerText || "")).join(" ");
  const authenticated = /로그아웃|log\\s*out|sign\\s*out/i.test(labels);
  const blocked = /unable\\s+to\\s+give\\s+you\\s+access|security\\s+issue\\s+was\\s+automatically\\s+identified|http\\s*403\\s*[-:]?\\s*forbidden|보안\\s*문자|자동입력\\s*방지|비정상적인\\s*접근|access\\s*denied/i.test(text);
  const inputs = [...document.querySelectorAll("input")].filter((el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  });
  return { authenticated, blocked, hasLoginForm: inputs.some((el) => el.type === "password"), url: String(location.href || "") };
})()`;

export function externalFillScript(x, y, value) {
  const point = `${Math.round(Number(x))}, ${Math.round(Number(y))}`;
  const text = JSON.stringify(String(value ?? ""));
  return `(() => {
    const el = document.elementFromPoint(${point});
    if (!el || !("value" in el)) return false;
    try {
      el.focus();
    } catch {
      // Focus failure must not stop the value assignment below.
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (descriptor && typeof descriptor.set === "function") descriptor.set.call(el, ${text});
      else el.value = ${text};
    } catch {
      el.value = ${text};
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === ${text};
  })()`;
}

// Naver shows a new-device confirmation ("새로운 기기에서 로그인") after the
// password submit. It has no login form, so the flow would wait on it
// forever: detect its 등록 button and click through once.
export const EXTERNAL_DEVICE_CONFIRM_SCRIPT = `(() => {
  const buttons = [...document.querySelectorAll("a,button,input")].filter((el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  });
  const target = buttons.find((el) => /^\\s*등록\\s*$/.test(String(el.innerText || el.textContent || el.value || "")));
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()`;

// Search-facet checkboxes (LotteON 판매처/브랜드, SSG department/brand).
// Finds unchecked boxes whose label matches exactly (an optional result
// count suffix is allowed) and clicks them. Never touches other controls;
// unmatched labels are reported instead of guessed.
export const EXTERNAL_FACET_CHECK_SCRIPT = `((wanted) => {
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const wants = [...new Set((Array.isArray(wanted) ? wanted : []).map(normalize).filter(Boolean))];
  const labelOf = (input) => {
    const direct = input.getAttribute && input.getAttribute("aria-label");
    if (direct && direct.trim()) return direct;
    const id = input.id;
    if (id && input.ownerDocument) {
      try {
        const labels = input.ownerDocument.querySelectorAll("label");
        for (const el of labels) {
          if (el.getAttribute && el.getAttribute("for") === id && el.textContent && el.textContent.trim()) {
            return el.textContent;
          }
        }
      } catch {
        // Label lookup failure falls through to the wrapping label below.
      }
    }
    const wrapping = input.closest ? input.closest("label") : null;
    if (wrapping && wrapping.textContent && wrapping.textContent.trim()) return wrapping.textContent;
    return "";
  };
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const matches = (label, want) => label === want || new RegExp("^" + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s*\\\\(?\\\\d+\\\\)?)?$").test(label);
  const checked = [];
  const missing = [];
  const inputs = [...document.querySelectorAll('input[type="checkbox"]')].filter(visible);
  for (const want of wants) {
    const box = inputs.find((input) => matches(normalize(labelOf(input)), want));
    if (!box) {
      missing.push(want);
      continue;
    }
    if (!box.checked) {
      try {
        box.click();
      } catch {
        // A failed click leaves the box for the verification pass below.
      }
    }
    checked.push(want);
  }
  const settled = inputs.every((input) => {
    const label = normalize(labelOf(input));
    const want = wants.find((item) => matches(label, item));
    return !want || input.checked === true;
  });
  return { checked, missing, settled };
})`;

export async function checkSearchFacets({ page, labels = [], sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), settleMs = 3000 } = {}) {
  const wanted = [...new Set((Array.isArray(labels) ? labels : []).map((label) => String(label || "").trim()).filter(Boolean))];
  if (!page || typeof page.evaluate !== "function" || !wanted.length) {
    return { checked: [], missing: wanted, settled: false };
  }
  const run = async () => {
    try {
      return await page.evaluate(`(${EXTERNAL_FACET_CHECK_SCRIPT})(${JSON.stringify(wanted)})`);
    } catch {
      return null;
    }
  };
  const first = await run();
  if (!first || typeof first !== "object") return { checked: [], missing: wanted, settled: false };
  // A reused tab resolves its next search navigation instantly while the
  // filter panel still renders: the first pass can miss every label even
  // though the boxes appear a moment later. Retry whenever anything is
  // missing so a late-rendering panel still gets checked.
  if (first.missing && first.missing.length) {
    await sleepImpl(Math.max(0, Number(settleMs) || 0));
    const again = await run();
    if (again && typeof again === "object") return {
      checked: Array.isArray(again.checked) ? again.checked : [],
      missing: Array.isArray(again.missing) ? again.missing : wanted,
      settled: again.settled === true,
    };
  }
  return {
    checked: Array.isArray(first.checked) ? first.checked : [],
    missing: Array.isArray(first.missing) ? first.missing : wanted,
    settled: first.settled === true,
  };
}

// Facet checkbox points for VISIBLE mouse clicks. Unlike the checking
// script above, this never clicks: it returns clickable points of matching
// boxes (unchecked by default, or checked when wantChecked is true) so the
// caller can drive a real, observable mouse through CDP.
export const EXTERNAL_FACET_POINT_SCRIPT = `((wanted, wantChecked) => {
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const wants = [...new Set((Array.isArray(wanted) ? wanted : []).map(normalize).filter(Boolean))];
  const labelOf = (input) => {
    const direct = input.getAttribute && input.getAttribute("aria-label");
    if (direct && direct.trim()) return direct;
    const id = input.id;
    if (id && input.ownerDocument) {
      try {
        const labels = input.ownerDocument.querySelectorAll("label");
        for (const el of labels) {
          if (el.getAttribute && el.getAttribute("for") === id && el.textContent && el.textContent.trim()) {
            return el.textContent;
          }
        }
      } catch {
        // Label lookup failure falls through to the wrapping label below.
      }
    }
    const wrapping = input.closest ? input.closest("label") : null;
    if (wrapping && wrapping.textContent && wrapping.textContent.trim()) return wrapping.textContent;
    return "";
  };
  const pointOf = (input) => {
    try {
      const rect = input.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    } catch {
      return null;
    }
  };
  const matches = (label, want) => label === want || new RegExp("^" + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s*\\\\(?\\\\d+\\\\)?)?$").test(label);
  const points = [];
  for (const input of document.querySelectorAll('input[type="checkbox"]')) {
    if (Boolean(input.checked) !== Boolean(wantChecked)) continue;
    const label = normalize(labelOf(input));
    const want = wants.find((item) => matches(label, item));
    if (!want) continue;
    const point = pointOf(input);
    if (point) points.push({ ...point, label: want });
  }
  return points;
})`;

// Unchecks matching facet boxes inside the page (collection flow, where no
// CDP mouse exists). Returns the labels that were unchecked.
export const EXTERNAL_FACET_UNCHECK_SCRIPT = `((wanted) => {
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const wants = [...new Set((Array.isArray(wanted) ? wanted : []).map(normalize).filter(Boolean))];
  const labelOf = (input) => {
    const direct = input.getAttribute && input.getAttribute("aria-label");
    if (direct && direct.trim()) return direct;
    const id = input.id;
    if (id && input.ownerDocument) {
      try {
        const labels = input.ownerDocument.querySelectorAll("label");
        for (const el of labels) {
          if (el.getAttribute && el.getAttribute("for") === id && el.textContent && el.textContent.trim()) {
            return el.textContent;
          }
        }
      } catch {
        // Label lookup failure falls through to the wrapping label below.
      }
    }
    const wrapping = input.closest ? input.closest("label") : null;
    if (wrapping && wrapping.textContent && wrapping.textContent.trim()) return wrapping.textContent;
    return "";
  };
  const matches = (label, want) => label === want || new RegExp("^" + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s*\\\\(?\\\\d+\\\\)?)?$").test(label);
  const unchecked = [];
  for (const input of document.querySelectorAll('input[type="checkbox"]')) {
    if (!input.checked) continue;
    const label = normalize(labelOf(input));
    const want = wants.find((item) => matches(label, item));
    if (!want) continue;
    try {
      input.click();
      unchecked.push(want);
    } catch {
      // A failed toggle leaves the box checked for the verification pass.
    }
  }
  return { unchecked };
})`;

// Visible filter checkbox labels for diagnosis. Never clicks: returns the
// labels the page actually offers so a missed wanted label can be told
// apart from a renamed filter menu. Capped and truncated; diagnostics only.
export const EXTERNAL_FACET_LABELS_SCRIPT = `(() => {
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const labelOf = (input) => {
    const direct = input.getAttribute && input.getAttribute("aria-label");
    if (direct && direct.trim()) return direct;
    const id = input.id;
    if (id && input.ownerDocument) {
      try {
        const labels = input.ownerDocument.querySelectorAll("label");
        for (const el of labels) {
          if (el.getAttribute && el.getAttribute("for") === id && el.textContent && el.textContent.trim()) {
            return el.textContent;
          }
        }
      } catch {
        // Label lookup failure falls through to the wrapping label below.
      }
    }
    const wrapping = input.closest ? input.closest("label") : null;
    if (wrapping && wrapping.textContent && wrapping.textContent.trim()) return wrapping.textContent;
    return "";
  };
  const seen = [];
  for (const input of document.querySelectorAll('input[type="checkbox"]')) {
    try {
      const rect = input.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
    } catch {
      continue;
    }
    const label = normalize(labelOf(input)).slice(0, 40);
    if (!label || seen.some((entry) => entry.label === label)) continue;
    seen.push({ label, checked: input.checked === true });
    if (seen.length >= 40) break;
  }
  return seen;
})()`;
// Article card point for a VISIBLE mouse click. Returns the best point plus
// its URL without clicking; the caller drives the observable mouse.
// With requireBadge, only cards carrying department wording (백화점/아울렛)
// qualify: marketplace/parallel-import cards must never be clicked, even
// with an exact article code. Reports "not-badged" when the article exists
// but no badged card does, so the caller can skip instead of clicking blind.
export const EXTERNAL_PRODUCT_CARD_POINT_SCRIPT = `((article, requireBadge) => {
  const compact = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = compact(article);
  if (!want) return { reason: "missing" };
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const productShaped = (href) => /\\/(?:p\\/)?product(?:\\/|$)|itemView|goods\\/|products?\\/\\d/i.test(String(href || ""));
  let best = null;
  let bestScore = 0;
  let bestUrl = "";
  let sawArticle = false;
  for (const link of [...document.querySelectorAll('a[href]')].filter(visible)) {
    const href = String(link.href || "");
    const selfHit = compact(href + " " + (link.textContent || "")).includes(want);
    const card = link.closest ? link.closest("li,article") : null;
    const cardHit = !selfHit && card && compact(card.textContent).includes(want);
    const shaped = productShaped(href);
    const score = selfHit && shaped ? 3 : selfHit ? 2 : cardHit && shaped ? 1 : -1;
    if (score > -1) sawArticle = true;
    if (requireBadge) {
      const badgeScope = card || (link.closest ? link.closest("li,article,div") : null);
      const badgeText = String(link.textContent || "") + " " + String(badgeScope ? badgeScope.textContent : "");
      if (!/백화점|아울렛/i.test(badgeText)) continue;
    }
    if (score <= bestScore) continue;
    let point = null;
    try {
      const rect = link.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      }
    } catch {
      point = null;
    }
    if (!point) continue;
    bestScore = score;
    best = point;
    bestUrl = href;
  }
  if (!best) return { reason: sawArticle ? "not-badged" : "not-found" };
  return { x: best.x, y: best.y, url: bestUrl };
})`;

// SSG top-right person-icon login entry. The event/promotion pages where a
// stalled login sits have no login form and no provider button; the header
// person icon is the visible way back. Returns its href or "". Visible links
// win; hidden dropdown links (person-icon hover menu) still count because
// navigation needs no visibility.
export const EXTERNAL_SSG_LOGIN_ENTRY_SCRIPT = `(() => {
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const inTopChrome = (el) => {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (/^(HEADER|NAV)$/i.test(node.tagName || "")) return true;
    }
    return false;
  };
  const loginHref = (el) => {
    if (!/login/i.test(el.href || "")) return false;
    if (!inTopChrome(el)) return false;
    return !/고객센터|고객|help|support|join|register|회원가입/i.test(el.textContent || "");
  };
  const links = [...document.querySelectorAll("a[href]")];
  const shown = links.filter(visible).find(loginHref);
  if (shown) return String(shown.href || "");
  const hidden = links.find(loginHref);
  return hidden ? String(hidden.href || "") : "";
})()`;

// SSG top-menu department link (백화점 tab href). Prefers the tab's own
// scoped href; the caller navigates so the scoping stays observable.
export const EXTERNAL_SSG_DEPARTMENT_HREF_SCRIPT = `(() => {
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const scoped = [...document.querySelectorAll("a[href]")].filter(visible)
    .find((el) => /shpp=department/i.test(el.href || ""));
  return scoped ? String(scoped.href || "") : "";
})()`;

// SSG top-menu department tab point (href-less fallback). Only a tab inside
// the search-filter area may be clicked; header navigation never qualifies.
export const EXTERNAL_SSG_DEPARTMENT_TAB_POINT_SCRIPT = `(() => {
  const text = (el) => String(el?.innerText || el?.textContent || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const tab = [...document.querySelectorAll("a,button,[role='tab']")].filter(visible).find((el) => {
    if (text(el) !== "백화점") return false;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (/^(BODY|HTML)$/i.test(node.tagName || "")) break;
      if (/검색\\s*필터/.test(text(node).slice(0, 400))) return true;
    }
    return false;
  });
  if (!tab) return null;
  try {
    const rect = tab.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  } catch {
    return null;
  }
})()`;

// Counts distinct product links carrying the article at card level. Guards
// scope filters: a scope that empties the grid must be reverted, never kept.
// Only product-shaped links count: navigation and related-search links that
// echo the article must never pass for grid evidence.
export const EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT = `((article) => {
  const compact = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = compact(article);
  if (!want) return 0;
  const productShaped = (href) => /\\/(?:p\\/)?product(?:\\/|$)|itemView|productDetail\\.action|goods\\/|products?\\/\\d/i.test(String(href || ""));
  const hits = new Set();
  for (const link of document.querySelectorAll("a[href]")) {
    const href = String(link.href || "");
    if (!productShaped(href)) continue;
    const card = link.closest ? link.closest("li,article") : null;
    const text = compact(href + " " + String(link.textContent || "") + " " + (card ? String(card.textContent || "") : ""));
    if (text.includes(want)) hits.add(href.split("#")[0]);
  }
  return hits.size;
})`;

// Grid cards for collection from the logged-in shared tab. Returns an array
// of product cards for product-shaped links. Never clicks; the caller
// analyzes and merges these with hidden/server evidence, which applies all
// seller and identity gates. No shadow-DOM walk: the hidden capture already
// covers shadow roots.
export const EXTERNAL_GRID_CARDS_SCRIPT = `((article) => {
  const compact = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const expectedCompact = compact(article);
  const expectedBase = String(article || "").split(/[-_]/)[0].replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const matchesExpected = (value) => {
    const text = compact(value);
    return Boolean(expectedCompact && text.includes(expectedCompact))
      || Boolean(expectedBase.length >= 5 && text.includes(expectedBase));
  };
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const productShaped = (href) => {
    const url = String(href || "");
    return url.includes("/product/") || url.includes("/products/") || url.includes("itemView")
      || url.includes("productDetail") || url.includes("/goods/");
  };
  const cards = [];
  const seen = new Set();
  for (const link of [...document.querySelectorAll("a[href]")]) {
    const productUrl = String(link.href || "").split("#")[0];
    if (!productUrl || seen.has(productUrl)) continue;
    if (!productShaped(productUrl)) continue;
    const inCard = visible(link) || matchesExpected(link.href) || matchesExpected(link.outerHTML);
    if (!inCard) continue;
    seen.add(productUrl);
    const card = link.closest ? (link.closest("li,article,[data-product-id],[class*='product-card'],[class*='goods-item']") || link.closest("li,article,div")) : null;
    const text = String((card && card.textContent) || link.textContent || "").trim();
    const image = card ? card.querySelector("img[src],img[data-src]") : null;
    const imageUrl = String((image && (image.currentSrc || image.src)) || "");
    const title = String((image && image.alt) || link.getAttribute("aria-label") || text || "").trim();
    // Display only: the detail page proves the authoritative price. Cards
    // render the struck original first and the sale price last. The article
    // code itself glues onto prices in condensed card text, so strip it
    // first. Plain character scans: no regex escapes involved.
    const SPACE_CHARS = [" ", String.fromCharCode(9), String.fromCharCode(10), String.fromCharCode(13), String.fromCharCode(160)];
    const WON = String.fromCharCode(50896);
    const isDigit = (ch) => ch >= "0" && ch <= "9";
    const scanPrices = (input) => {
      const found = [];
      let digits = "";
      let gap = "";
      const push = () => {
        if (digits) found.push(digits + WON);
        digits = "";
        gap = "";
      };
      for (const ch of String(input || "")) {
        if (isDigit(ch)) {
          digits += gap + ch;
          gap = "";
        } else if (ch === ",") {
          if (digits) digits += ch;
        } else if (SPACE_CHARS.indexOf(ch) >= 0) {
          if (digits) gap += ch;
        } else if (ch === WON) {
          if (digits) push();
          else {
            digits = "";
            gap = "";
          }
        } else {
          digits = "";
          gap = "";
        }
      }
      return found;
    };
    const priceStripped = String(article || "").trim()
      ? text.split(String(article || "").trim()).join(" ")
      : text;
    const priceMatches = scanPrices(priceStripped);
    const priceLine = priceMatches.length ? priceMatches[priceMatches.length - 1] : "";
    const channelText = [text, link.outerHTML].join(" ");
    cards.push({
      productUrl,
      title,
      text,
      imageUrl,
      imageLinkedToProduct: Boolean(imageUrl),
      price: priceLine,
      originalPrice: "",
      officialBrandStoreLabelMatched: /브랜드 ?직영몰|공식 ?브랜드|브랜드 ?스토어/.test(channelText),
      departmentStoreLabelMatched: /백화점/.test(channelText),
      outletLabelMatched: /아울렛|outlet/i.test(channelText),
    });
    if (cards.length >= 60) break;
  }
  return cards;
})`;

// Applies facet labels through VISIBLE CDP mouse clicks, then verifies with
// the standard settle pass. Returns the verification result.
export async function clickSearchFacetsVisibly({ page, labels = [], sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), settleMs = 3000 } = {}) {
  const wanted = [...new Set((Array.isArray(labels) ? labels : []).map((label) => String(label || "").trim()).filter(Boolean))];
  if (!page || typeof page.evaluate !== "function" || !wanted.length) {
    return { checked: [], missing: wanted, settled: false };
  }
  // The search tab is reused across products: a warm SPA navigation resolves
  // instantly while its filter panel still renders. The first (cold) search
  // then checks the box and every later (warm) search misses it. Wait for at
  // least one wanted label to exist before computing click points. The point
  // script never clicks, so probing in both states is side-effect free; an
  // already-checked box also counts as rendered. Bounded and fail-open: the
  // verification pass below still reports the outcome.
  for (let waited = 0; waited < 8000; waited += 1000) {
    let seen = 0;
    try {
      const unchecked = await page.evaluate(`(${EXTERNAL_FACET_POINT_SCRIPT})(${JSON.stringify(wanted)}, false)`);
      const checked = await page.evaluate(`(${EXTERNAL_FACET_POINT_SCRIPT})(${JSON.stringify(wanted)}, true)`);
      seen = (Array.isArray(unchecked) ? unchecked.length : 0) + (Array.isArray(checked) ? checked.length : 0);
    } catch {
      seen = 0;
    }
    if (seen > 0) break;
    await sleepImpl(1000);
  }
  try {
    const points = await page.evaluate(`(${EXTERNAL_FACET_POINT_SCRIPT})(${JSON.stringify(wanted)}, false)`);
    for (const point of Array.isArray(points) ? points : []) {
      if (typeof page.clickPoint !== "function") break;
      await page.clickPoint(point);
      await sleepImpl(400);
    }
  } catch {
    // A failed visible click falls through to the verification pass below.
  }
  return checkSearchFacets({ page, labels: wanted, sleepImpl, settleMs });
}

// SSG top-menu department tab (백화점). Runs inside the page. Returns the
// tab's department-scoped href, "clicked" after clicking a href-less tab, or
// "" when absent. A header navigation link shares the 백화점 label, so only
// the tab inside the search-filter area may be clicked; scoped hrefs are
// preferred because they navigate to the exact operator-equivalent state.
export function findSsgDepartmentTab() {
  const text = (el) => String(el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const links = [...document.querySelectorAll("a[href]")].filter(visible);
  const scopedLink = links.find((el) => /shpp=department/i.test(el.href || ""));
  if (scopedLink) return scopedLink.href;
  const tab = [...document.querySelectorAll("a,button,[role='tab']")].filter(visible).find((el) => {
    if (text(el) !== "백화점") return false;
    // Walk up only inside the filter panel: reaching BODY/HTML means the
    // label came from the site header navigation, never the search tab.
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (/^(BODY|HTML)$/i.test(node.tagName || "")) break;
      if (/검색\s*필터/.test(String(node.innerText || node.textContent || "").slice(0, 400))) return true;
    }
    return false;
  });
  if (tab) {
    try {
      tab.click();
      return "clicked";
    } catch {
      return "";
    }
  }
  return "";
}

export function filterUsableLoginCookies(cookies = [], now = Date.now() / 1000) {
  return (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
    if (!cookie || !String(cookie.value || "")) return false;
    const expiration = Number(cookie?.expirationDate);
    if (Number.isFinite(expiration) && expiration > 0 && expiration <= now) return false;
    return true;
  });
}

async function fillPasswordForm(page, detectControlsScript, credentials) {
  let controls = null;
  try {
    controls = await page.evaluate(`(${String(detectControlsScript)})("password")`);
  } catch {
    return false;
  }
  if (!controls?.id || !controls?.password || !(controls?.submit || controls?.next)) return false;
  try {
    const idOk = await page.evaluate(externalFillScript(controls.id.x, controls.id.y, credentials.loginId));
    const passwordOk = await page.evaluate(externalFillScript(controls.password.x, controls.password.y, credentials.password));
    if (!idOk || !passwordOk) return false;
    await page.clickPoint(controls.submit || controls.next);
    return true;
  } catch {
    return false;
  }
}

async function clickProviderButton(page, detectControlsScript, method) {
  let controls = null;
  try {
    controls = await page.evaluate(`(${String(detectControlsScript)})(${JSON.stringify(method)})`);
  } catch {
    return false;
  }
  if (!controls?.provider) return false;
  try {
    await page.clickPoint(controls.provider);
    return true;
  } catch {
    return false;
  }
}

async function clickDeviceConfirmButton(page) {
  let point = null;
  try {
    point = await page.evaluate(EXTERNAL_DEVICE_CONFIRM_SCRIPT);
  } catch {
    return false;
  }
  if (!point) return false;
  try {
    await page.clickPoint(point);
    return true;
  } catch {
    return false;
  }
}

// SSG finishes its login inside an SSO callback popup (sslCallback.ssg)
// that hands the session to the opener window. Our tab has no opener, so the
// callback sits blank forever: detect it and recover by reloading the
// merchant homepage, where the profile-wide session cookies already render
// the logged-in state.
export function isSsoCallbackUrl(url = "", merchantDomains = []) {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(String(url || ""));
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return false;
  }
  const listed = Array.isArray(merchantDomains) ? merchantDomains : [];
  const merchant = listed.some((domain) => domain && (host === domain || host.endsWith(`.${domain}`)));
  return merchant && /callback/i.test(path);
}

export function merchantHomepageUrl(merchantDomains = []) {
  const domain = (Array.isArray(merchantDomains) ? merchantDomains : []).find(Boolean);
  return domain ? `https://www.${domain}/` : "";
}

// True when the observed page is anywhere but the login entry (event or
// promotion landing, stale tab). Query strings are ignored: the entry
// itself keeps the legacy path so a slowly rendering form is never
// reloaded away. Unparseable URLs fail closed (no re-entry).
export function isOffLoginEntry(pageUrl = "", loginUrl = "") {
  if (!String(loginUrl || "")) return false;
  try {
    const here = new URL(String(pageUrl || ""));
    const entry = new URL(String(loginUrl));
    return `${here.origin}${here.pathname}` !== `${entry.origin}${entry.pathname}`;
  } catch {
    return false;
  }
}

// Pure step planner for the visible login route in screenshot order:
// merchant login page → password fill or provider click → provider login
// page → provider fill. Each automatic step fires at most once; afterwards
// the visible window stays for manual completion.
export function planExternalLoginStep({ pageUrl = "", merchantDomains = [], method = "password", acted = {} } = {}) {
  let host = "";
  try {
    host = new URL(String(pageUrl || "")).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const listed = Array.isArray(merchantDomains) ? merchantDomains : [];
  const onMerchant = listed.length === 0
    || listed.some((domain) => host === domain || (domain && host.endsWith(`.${domain}`)));
  const onProvider = (method === "naver" && /(^|\.)nid\.naver\.com$/.test(host))
    || (method === "kakao" && /(^|\.)accounts\.kakao\.com$/.test(host));
  const onDeviceConfirm = method === "naver"
    && /nid\.naver\.com\/login\/ext\/deviceConfirm/i.test(String(pageUrl || ""));
  if (onDeviceConfirm && !acted.confirm_device) return "confirm_device";
  if (onMerchant && method === "password" && !acted.fill_merchant) return "fill_merchant";
  if (onMerchant && (method === "naver" || method === "kakao") && !acted.click_provider) return "click_provider";
  if (onProvider && !acted.fill_provider) return "fill_provider";
  return "wait";
}

export async function waitForExternalLogin({
  page,
  // Extra tabs of the same window (SSG opens its Naver OAuth as another
  // popup). Observed every poll so a login that continues in a popup still
  // completes instead of timing out on the original tab.
  discoverPages = null,
  detectControlsScript = null,
  // Email verification hook (Naver on unfamiliar devices): an OTP input
  // script plus a mailbox code fetcher supplied by the caller. The newest
  // code is filled exactly once per login run; without the hook, or after
  // the single attempt, the visible window stays for manual entry.
  otpInputScript = null,
  fetchOtpCode = null,
  credentials = null,
  providerCredentials = null,
  method = "password",
  merchantDomains = [],
  loginUrl = "",
  timeoutMs = 180000,
  pollIntervalMs = 2000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  canceled = () => false,
  onProgress = null,
} = {}) {
  if (!page || typeof page.evaluate !== "function" || typeof page.getCookies !== "function") {
    return externalLoginFailure("CDP_UNREACHABLE");
  }
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 180000);
  const usable = (entry) => Boolean(entry?.loginId && entry?.password);
  const canFillMerchant = method === "password" && usable(credentials) && Boolean(detectControlsScript);
  const canClickProvider = (method === "naver" || method === "kakao") && Boolean(detectControlsScript);
  const canFillProvider = (method === "naver" || method === "kakao") && usable(providerCredentials) && Boolean(detectControlsScript);
  const acted = {};
  // Survives navigation unlike acted: once a fill or provider click has
  // fired, post-submit and OAuth landings belong to the running flow.
  let loginFlowStarted = false;
  // Email verification codes are single-shot per login run: a wrong code is
  // never resubmitted automatically, so guessing can never lock the account.
  let otpSubmitted = false;
  // A slow login page must not burn the single automatic attempt before its
  // form exists: attempts are capped per page so a half-loaded first poll
  // retries instead of giving up, without resubmitting forever.
  const attempts = {};
  const MAX_AUTO_ATTEMPTS_PER_PAGE = 5;
  const attemptsLeft = (step, url) => (attempts[`${step}@${url}`] || 0) < MAX_AUTO_ATTEMPTS_PER_PAGE;
  const noteAttempt = (step, url) => {
    attempts[`${step}@${url}`] = (attempts[`${step}@${url}`] || 0) + 1;
  };
  let lastActedUrl = "";
  let unreadable = 0;
  let tick = 0;
  const heartbeat = (state) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({ tick: (tick += 1), authenticated: state?.authenticated === true });
    } catch {
      // Progress reporting must never stop the login observation.
    }
  };
  const observeTabs = async () => {
    let extras = [];
    try {
      const found = typeof discoverPages === "function" ? await discoverPages() : [];
      if (Array.isArray(found)) {
        extras = found.filter((client) => client && client !== page && typeof client.evaluate === "function");
      }
    } catch {
      extras = [];
    }
    const observations = [];
    for (const client of [page, ...extras]) {
      let state = null;
      try {
        state = await client.evaluate(EXTERNAL_LOGIN_STATE_SCRIPT);
      } catch {
        state = null;
      }
      observations.push({
        client,
        state: state && typeof state === "object" ? state : null,
      });
    }
    return observations;
  };
  while (Date.now() < deadline) {
    if (canceled()) return externalLoginFailure("LOGIN_CANCELED");
    const observations = await observeTabs();
    const readable = observations.filter((item) => item.state);
    if (!readable.length) {
      unreadable += 1;
      // SSG login runs SSO/bot-check redirect chains during which CDP
      // evaluation fails for tens of seconds. Only a sustained blackout
      // proves a dead page; the overall timeout still bounds the wait.
      if (unreadable >= 15) return externalLoginFailure("LOGIN_PAGE_UNREADABLE");
      heartbeat(null);
      await sleepImpl(pollIntervalMs);
      continue;
    }
    unreadable = 0;
    const done = readable.find((item) => item.state.authenticated === true);
    if (done) {
      let cookies = [];
      try {
        cookies = await done.client.getCookies();
      } catch {
        cookies = [];
      }
      return { ok: true, cookies: filterUsableLoginCookies(cookies) };
    }
    // An SSO callback tab without any login form anywhere means the merchant
    // already accepted the login and only the opener handshake is missing:
    // reload the merchant homepage once so its session renders. Fires once.
    const homeUrl = merchantHomepageUrl(merchantDomains);
    const callbackStuck = homeUrl && !acted.recover_callback
      && readable.some((item) => isSsoCallbackUrl(item.state.url, merchantDomains))
      && !readable.some((item) => item.state.hasLoginForm === true);
    let actedThisRound = false;
    if (callbackStuck) {
      acted.recover_callback = true;
      actedThisRound = true;
      try {
        await page.navigate(homeUrl);
      } catch {
        // A failed recovery navigation simply leaves manual observation.
      }
    }
    const actionable = !callbackStuck && readable.find((item) =>
      planExternalLoginStep({ pageUrl: item.state.url, merchantDomains, method, acted }) !== "wait");
    if (!actionable && !callbackStuck) {
      // Stale one-shot flags from a previous page can pin every tab to
      // "wait" forever: the navigation already consumed them, so a new page
      // deserves a fresh evaluation instead of idling to timeout. Same-page
      // flags are never cleared, so a submitted form is never resubmitted.
      // The callback recovery above survives this reset.
      const fresh = acted.recover_callback ? { recover_callback: true } : {};
      const revived = readable.find((item) =>
        planExternalLoginStep({ pageUrl: item.state.url, merchantDomains, method, acted: fresh }) !== "wait");
      if (revived && String(revived.state.url || "") !== lastActedUrl) {
        for (const key of Object.keys(acted)) if (key !== "recover_callback") delete acted[key];
        lastActedUrl = String(revived.state.url || "");
      }
    }
    if (actionable) {
      const step = planExternalLoginStep({ pageUrl: actionable.state.url, merchantDomains, method, acted });
      const url = String(actionable.state.url || "");
      // Navigation opens a fresh opportunity: a new page may need its own
      // fill or click even when the previous page already consumed one.
      // The one-shot callback recovery survives navigation.
      if (url !== lastActedUrl) {
        lastActedUrl = url;
        for (const key of Object.keys(acted)) if (key !== "recover_callback") delete acted[key];
      }
      // A merchant page without a login form (event/promotion landing, stale
      // tab) has no provider button to click. Return to the login entry
      // instead of clicking blindly until attempts run out. The login entry
      // itself keeps the old path so a slowly rendering form is never
      // reloaded away, and SSO callbacks keep their recovery below. On SSG
      // the top-right person icon is the visible way back; elsewhere (and as
      // a fallback) the login URL is used. Once a fill or provider click has
      // fired, the flow owns the tab: post-submit interstitials and OAuth
      // landings are formless but must be left alone, never yanked away.
      const needsLoginForm = step === "click_provider" || step === "fill_merchant";
      if (needsLoginForm
        && !loginFlowStarted
        && actionable.state.hasLoginForm !== true
        && isOffLoginEntry(url, loginUrl)
        && !isSsoCallbackUrl(url, merchantDomains)
        && attemptsLeft("navigate_login", String(loginUrl || "login-entry"))) {
        noteAttempt("navigate_login", String(loginUrl || "login-entry"));
        actedThisRound = true;
        const navigateTarget = async () => {
          const listed = Array.isArray(merchantDomains) ? merchantDomains : [];
          const ssgMerchant = listed.some((domain) => String(domain || "").toLowerCase() === "ssg.com"
            || String(domain || "").toLowerCase().endsWith(".ssg.com"));
          if (ssgMerchant) {
            try {
              const entryHref = String(await actionable.client.evaluate(EXTERNAL_SSG_LOGIN_ENTRY_SCRIPT) || "").trim();
              if (/^https?:\/\//i.test(entryHref)) return entryHref;
            } catch {
              // Fall through to the login URL below.
            }
          }
          return String(loginUrl || "");
        };
        try {
          const target = await navigateTarget();
          if (/^https?:\/\//i.test(target)) {
            if (typeof actionable.client.navigate === "function") {
              await actionable.client.navigate(target);
            } else if (actionable.client === page && typeof page.navigate === "function") {
              await page.navigate(target);
            }
          }
        } catch {
          // A failed re-entry leaves manual observation.
        }
      } else if (step === "fill_merchant" && canFillMerchant && attemptsLeft(step, url)) {
        noteAttempt(step, url);
        actedThisRound = true;
        if (await fillPasswordForm(actionable.client, detectControlsScript, credentials)) {
          acted.fill_merchant = true;
          loginFlowStarted = true;
        }
      } else if (step === "click_provider" && canClickProvider && attemptsLeft(step, url)) {
        noteAttempt(step, url);
        actedThisRound = true;
        if (await clickProviderButton(actionable.client, detectControlsScript, method)) {
          acted.click_provider = true;
          loginFlowStarted = true;
        }
      } else if (step === "fill_provider" && canFillProvider && attemptsLeft(step, url)) {
        noteAttempt(step, url);
        actedThisRound = true;
        if (await fillPasswordForm(actionable.client, detectControlsScript, providerCredentials)) {
          acted.fill_provider = true;
        }
      } else if (step === "confirm_device" && canClickProvider && attemptsLeft(step, url)) {
        noteAttempt(step, url);
        actedThisRound = true;
        if (await clickDeviceConfirmButton(actionable.client)) {
          acted.confirm_device = true;
        }
      }
    }
    if (!actedThisRound && !otpSubmitted && loginFlowStarted && typeof fetchOtpCode === "function" && otpInputScript) {
      for (const item of readable) {
        let points = null;
        try {
          points = await item.client.evaluate(String(otpInputScript));
        } catch {
          points = null;
        }
        if (!points?.otp || !points?.submit) continue;
        let code = "";
        try {
          code = String(await fetchOtpCode() || "");
        } catch {
          code = "";
        }
        // No code from the mailbox: leave the visible page for manual entry.
        if (!code) break;
        try {
          const filled = await item.client.evaluate(externalFillScript(points.otp.x, points.otp.y, code));
          if (filled) {
            await item.client.clickPoint(points.submit);
            otpSubmitted = true;
            actedThisRound = true;
          }
        } catch {
          // A failed fill keeps the manual verification path below.
        }
        break;
      }
    }
    if (!actedThisRound && readable.some((item) => item.state.blocked === true)
      && !readable.some((item) => item.state.hasLoginForm === true)) {
      return externalLoginFailure("LOGIN_BLOCKED");
    }
    heartbeat(readable[0]?.state);
    await sleepImpl(pollIntervalMs);
  }
  return externalLoginFailure("LOGIN_TIMEOUT");
}

export async function startExternalRetailerLogin({
  loginUrl = "",
  credentials = null,
  providerCredentials = null,
  method = "password",
  merchantDomains = [],
  chromeExecutable = "",
  userDataDir = "",
  port = 0,
  tabKey = "",
  detectControlsScript = null,
  autoTimeoutMs = 180000,
  manualTimeoutMs = 600000,
  cdpLaunchTimeoutMs = 20000,
  // Email verification hook, passed through to the login wait below.
  otpInputScript = null,
  fetchOtpCode = null,
  // Per-retailer window mode: each retailer keeps its own Chrome process that
  // stays alive across logins, so a logged-in session is kept instead of
  // logging in again for every product search. Callers pass the retailer's
  // own handle (never another retailer's) so windows stay isolated.
  shared = null,
  keepAlive = false,
  onShared = null,
  onProgress = null,
  deps = {},
} = {}) {
  const {
    spawnImpl,
    fetchImpl = fetch,
    WebSocketImpl = globalThis.WebSocket,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    canceled = () => false,
  } = deps;
  if (!chromeExecutable) return externalLoginFailure("CHROME_NOT_FOUND");
  if (typeof spawnImpl !== "function" || typeof WebSocketImpl !== "function") {
    return externalLoginFailure("CHROME_LAUNCH_FAILED");
  }
  // Reuse the retailer's own window when its process is still alive: the
  // retailer then opens as a tab of its own window instead of a new Chrome process.
  let child = shared && shared.child && shared.child.killed !== true && shared.child.exitCode == null
    ? shared.child
    : null;
  let targetPort = Number(port) > 0 ? Number(port) : Number(shared?.port) || 0;
  let responsive = Boolean(child && targetPort) && await isChromeResponsive({ fetchImpl, port: targetPort });
  if (!responsive) {
    child = null;
    targetPort = Number(port) > 0 ? Number(port) : await pickRemoteDebuggingPort({ fetchImpl });
    if (!targetPort) return externalLoginFailure("CDP_UNREACHABLE");
    try {
      // Launching with the URL argument is the proven path: some Chrome
      // builds ignore the /json/new?url= parameter and leave blank tabs.
      child = spawnImpl(chromeExecutable, chromeLoginArgs({ userDataDir, port: targetPort, url: loginUrl }), {
        windowsHide: true,
      });
    } catch {
      return externalLoginFailure("CHROME_LAUNCH_FAILED");
    }
    if (typeof onShared === "function") {
      try {
        onShared({ child, port: targetPort });
      } catch {
        // Retaining the shared handle must not fail the login itself.
      }
    }
  }
  const kill = () => closeLoginChrome(child);
  try {
    // Wait for the debugger first so a slow launch never sprays login tabs.
    const launchDeadline = Date.now() + Math.max(5000, Number(cdpLaunchTimeoutMs) || 20000);
    let ready = responsive;
    while (!ready && Date.now() < launchDeadline) {
      if (canceled()) return externalLoginFailure("LOGIN_CANCELED");
      ready = await isChromeResponsive({ fetchImpl, port: targetPort });
      if (!ready) await sleepImpl(500);
    }
    if (!ready) return externalLoginFailure("CDP_UNREACHABLE");
    let page = null;
    let loginTabId = "";
    try {
      const acquired = await acquireLoginTab({
        fetchImpl,
        WebSocketImpl,
        port: targetPort,
        loginUrl,
        knownTabs: shared?.tabs,
        tabKey,
        allowedHostSuffixes: merchantDomains,
        sleepImpl,
        canceled,
      });
      loginTabId = acquired.targetId;
      page = createCdpPageClient({ fetchImpl, WebSocketImpl, port: targetPort, targetId: loginTabId });
      await closeBlankTabs({ fetchImpl, port: targetPort });
      if (typeof onShared === "function" && tabKey) {
        onShared({ child, port: targetPort, tabs: { ...(shared?.tabs || {}), [tabKey]: loginTabId } });
      }
    } catch (error) {
      const code = String(error?.message || "");
      const observedUrl = String(error?.observedUrl || "");
      const withUrl = (failure) => (observedUrl ? { ...failure, observedUrl } : failure);
      if (code === "LOGIN_CANCELED") return withUrl(externalLoginFailure("LOGIN_CANCELED"));
      if (code === "LOGIN_PAGE_UNREADABLE") return withUrl(externalLoginFailure("LOGIN_PAGE_UNREADABLE"));
      return withUrl(externalLoginFailure("CDP_UNREACHABLE"));
    }
    const automatic = (method === "password" && credentials?.loginId && credentials?.password)
      || ((method === "naver" || method === "kakao") && providerCredentials?.loginId && providerCredentials?.password);
    // SSG opens its Naver OAuth as another popup of the same window: observe
    // every tab so a login that continues outside the login tab still
    // completes instead of timing out on the original tab.
    const discoverLoginTabs = async () => {
      let targets = [];
      try {
        targets = await listPageTargets({ fetchImpl, port: targetPort });
      } catch {
        return [];
      }
      return targets
        .filter((entry) => entry.id !== loginTabId && entry.webSocketDebuggerUrl)
        .map((entry) => createCdpPageClient({ fetchImpl, WebSocketImpl, port: targetPort, targetId: entry.id }));
    };
    return await waitForExternalLogin({
      page,
      discoverPages: discoverLoginTabs,
      detectControlsScript,
      otpInputScript,
      fetchOtpCode,
      credentials,
      providerCredentials,
      method,
      merchantDomains,
      loginUrl,
      timeoutMs: automatic ? autoTimeoutMs : manualTimeoutMs,
      canceled,
      sleepImpl,
      onProgress,
    });
  } finally {
    // keepAlive retains the retailer's own window (with its logged-in tab)
    // across products; otherwise close the one-off window so
    // no stray Chrome survives the login.
    if (!keepAlive) kill();
  }
}
