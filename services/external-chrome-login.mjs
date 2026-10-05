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
    "--disable-features=Translate",
    "--new-window",
    String(url || "about:blank"),
  ];
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

export function filterUsableLoginCookies(cookies = [], now = Date.now() / 1000) {
  return (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
    if (!cookie || !String(cookie.value || "")) return false;
    const expiration = Number(cookie?.expirationDate);
    if (Number.isFinite(expiration) && expiration > 0 && expiration <= now) return false;
    return true;
  });
}

async function tryAutoFill(page, detectControlsScript, credentials) {
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

export async function waitForExternalLogin({
  page,
  detectControlsScript = null,
  credentials = null,
  timeoutMs = 180000,
  pollIntervalMs = 2000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  canceled = () => false,
} = {}) {
  if (!page || typeof page.evaluate !== "function" || typeof page.getCookies !== "function") {
    return externalLoginFailure("CDP_UNREACHABLE");
  }
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 180000);
  const canAutoFill = Boolean(credentials?.loginId && credentials?.password && detectControlsScript);
  let submitted = false;
  let unreadable = 0;
  while (Date.now() < deadline) {
    if (canceled()) return externalLoginFailure("LOGIN_CANCELED");
    let state = null;
    try {
      state = await page.evaluate(EXTERNAL_LOGIN_STATE_SCRIPT);
    } catch {
      state = null;
    }
    if (!state || typeof state !== "object") {
      unreadable += 1;
      if (unreadable >= 5) return externalLoginFailure("LOGIN_PAGE_UNREADABLE");
      await sleepImpl(pollIntervalMs);
      continue;
    }
    unreadable = 0;
    if (state.authenticated === true) {
      let cookies = [];
      try {
        cookies = await page.getCookies();
      } catch {
        cookies = [];
      }
      return { ok: true, cookies: filterUsableLoginCookies(cookies) };
    }
    if (state.blocked === true) return externalLoginFailure("LOGIN_BLOCKED");
    if (!submitted && canAutoFill && state.hasLoginForm === true) {
      submitted = await tryAutoFill(page, detectControlsScript, credentials);
    }
    await sleepImpl(pollIntervalMs);
  }
  return externalLoginFailure("LOGIN_TIMEOUT");
}

export async function startExternalRetailerLogin({
  loginUrl = "",
  credentials = null,
  chromeExecutable = "",
  userDataDir = "",
  port = 0,
  detectControlsScript = null,
  autoTimeoutMs = 180000,
  manualTimeoutMs = 600000,
  cdpLaunchTimeoutMs = 20000,
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
  const targetPort = Number(port) > 0 ? Number(port) : await pickRemoteDebuggingPort({ fetchImpl });
  if (!targetPort) return externalLoginFailure("CDP_UNREACHABLE");
  let child = null;
  try {
    child = spawnImpl(chromeExecutable, chromeLoginArgs({ userDataDir, port: targetPort, url: loginUrl }), {
      windowsHide: true,
    });
  } catch {
    return externalLoginFailure("CHROME_LAUNCH_FAILED");
  }
  const kill = () => {
    try {
      if (child && child.killed !== true && typeof child.kill === "function") child.kill();
    } catch {
      // The external window is best-effort cleanup only.
    }
  };
  try {
    const launchDeadline = Date.now() + Math.max(5000, Number(cdpLaunchTimeoutMs) || 20000);
    let page = null;
    let lastError = null;
    while (Date.now() < launchDeadline) {
      if (canceled()) return externalLoginFailure("LOGIN_CANCELED");
      try {
        const client = createCdpPageClient({ fetchImpl, WebSocketImpl, port: targetPort });
        await client.openTab(loginUrl);
        page = client;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await sleepImpl(500);
      }
    }
    if (!page) return externalLoginFailure(lastError ? "CDP_UNREACHABLE" : "CHROME_LAUNCH_FAILED");
    return await waitForExternalLogin({
      page,
      detectControlsScript,
      credentials,
      timeoutMs: credentials?.loginId && credentials?.password ? autoTimeoutMs : manualTimeoutMs,
      canceled,
      sleepImpl,
    });
  } finally {
    kill();
  }
}
