import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import {
  EXTERNAL_LOGIN_CODES,
  externalLoginMessage,
  externalLoginFailure,
  findChromeExecutable,
  chromeLoginArgs,
  pickRemoteDebuggingPort,
  createCdpPageClient,
  EXTERNAL_LOGIN_STATE_SCRIPT,
  externalFillScript,
  filterUsableLoginCookies,
  planExternalLoginStep,
  waitForExternalLogin,
  startExternalRetailerLogin,
} from "../services/external-chrome-login.mjs";

function fakeWebSocketClass(onSend) {
  return class {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.sent = [];
      this.closed = false;
    }
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
      if (type === "open") queueMicrotask(() => this.emit("open", {}));
    }
    send(text) {
      this.sent.push(String(text));
      onSend?.(this, String(text));
    }
    close() {
      this.closed = true;
    }
    emit(type, data) {
      for (const fn of this.handlers[type] || []) fn(data);
    }
  };
}

function reply(socket, payload) {
  queueMicrotask(() => socket.emit("message", { data: JSON.stringify(payload) }));
}

test("every failure code carries a Korean message", () => {
  for (const code of Object.values(EXTERNAL_LOGIN_CODES)) {
    assert.ok(externalLoginMessage(code).length > 4, code);
  }
  assert.equal(externalLoginFailure("NOPE").code, "LOGIN_TIMEOUT");
  assert.equal(externalLoginFailure("LOGIN_BLOCKED").message, externalLoginMessage("LOGIN_BLOCKED"));
});

test("chrome discovery skips unusable candidates on every platform", () => {
  assert.equal(findChromeExecutable({ existsSyncImpl: () => false, platformImpl: "win32" }), "");
  assert.equal(findChromeExecutable({ existsSyncImpl: () => false, platformImpl: "linux" }), "");
  assert.match(
    findChromeExecutable({ existsSyncImpl: () => true, platformImpl: "win32" }),
    /chrome\.exe$/,
  );
  assert.equal(
    findChromeExecutable({ existsSyncImpl: (path) => path === "/usr/bin/chromium", platformImpl: "linux" }),
    "/usr/bin/chromium",
  );
  assert.equal(
    findChromeExecutable({
      existsSyncImpl: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      platformImpl: "darwin",
    }),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
});

test("debugging port uses the first unreachable port", async () => {
  const free = await pickRemoteDebuggingPort({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(free, 9222);
  let calls = 0;
  const second = await pickRemoteDebuggingPort({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, json: async () => ({}) };
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(second, 9223);
  const none = await pickRemoteDebuggingPort({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), count: 2 });
  assert.equal(none, 0);
});

test("login launch arguments keep credentials off the command line", () => {
  const args = chromeLoginArgs({ userDataDir: "C:\\data\\ext", port: 9223, url: "https://www.ssg.com/" });
  assert.ok(args.some((arg) => arg.includes("--remote-debugging-port=9223")));
  assert.ok(args.some((arg) => arg.includes("--user-data-dir=")));
  assert.ok(args.includes("--new-window"));
  assert.doesNotMatch(args.join(" "), /password|passwd/i);
});

test("cdp evaluate returns the page value and surfaces exceptions", async () => {
  const sockets = [];
  const Socket = fakeWebSocketClass((socket, text) => {
    const request = JSON.parse(text);
    if (request.method === "Network.getAllCookies") {
      reply(socket, { id: 1, result: { cookies: [] } });
      return;
    }
    reply(socket, request.method === "Runtime.evaluate" && request.params.expression.includes("BOOM")
      ? { id: 1, result: { exceptionDetails: {} } }
      : { id: 1, result: { result: { value: 42 } } });
  });
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/json/list")) {
      return { ok: true, json: async () => [{ id: "T", type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools" }] };
    }
    throw new Error(`unexpected ${url}`);
  };
  const client = createCdpPageClient({ fetchImpl, WebSocketImpl: Socket, port: 9222 });
  assert.equal(await client.evaluate("1+1"), 42);
  await assert.rejects(() => client.evaluate("BOOM"), /CDP_EVALUATE_FAILED/);
  await client.clickPoint({ x: 10, y: 20 });
  await assert.rejects(() => client.clickPoint({}), /CDP_BAD_POINT/);
  assert.deepEqual(await client.getCookies(), []);
});

test("login state script detects logout, blocks and login forms", () => {
  const runState = (html, url) => {
    const dom = new JSDOM(html, { url, runScripts: "outside-only" });
    dom.window.Element.prototype.getBoundingClientRect = () => ({
      width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    });
    return vm.runInContext(EXTERNAL_LOGIN_STATE_SCRIPT, dom.getInternalVMContext());
  };
  const state = runState('<button>로그아웃</button><input type="password">', "https://www.ssg.com/");
  assert.equal(state.authenticated, true);

  assert.equal(runState("<body>HTTP 403 - Forbidden</body>", "https://www.ssg.com/").blocked, true);

  const formState = runState('<input type="text"><input type="password">', "https://www.lotteon.com/");
  assert.equal(formState.hasLoginForm, true);
  assert.equal(formState.authenticated, false);
});

test("fill script assigns values through the element under the point", () => {
  const dom = new JSDOM('<input id="id" type="text"><input id="pw" type="password">', {
    url: "https://www.ssg.com/",
    runScripts: "outside-only",
  });
  const context = dom.getInternalVMContext();
  const byId = { 1: dom.window.document.getElementById("id"), 2: dom.window.document.getElementById("pw") };
  dom.window.document.elementFromPoint = (x) => byId[x] || null;
  assert.equal(vm.runInContext(externalFillScript(1, 1, "user01"), context), true);
  assert.equal(dom.window.document.getElementById("id").value, "user01");
  assert.equal(vm.runInContext(externalFillScript(9, 9, "nothing"), context), false);
});

test("expired and empty cookies never count as a login session", () => {
  const now = 1_700_000_000;
  assert.deepEqual(
    filterUsableLoginCookies([
      { name: "a", value: "" },
      { name: "b", value: "1", expirationDate: now - 10 },
      { name: "c", value: "1", expirationDate: now + 3600 },
      { name: "d", value: "1" },
    ], now).map((cookie) => cookie.name),
    ["c", "d"],
  );
});

test("login route follows the merchant, provider click, provider fill order", () => {
  const merchant = { merchantDomains: ["lotteon.com"] };
  assert.equal(planExternalLoginStep({ pageUrl: "https://www.lotteon.com/p/member/login/common", method: "password", ...merchant }), "fill_merchant");
  assert.equal(planExternalLoginStep({ pageUrl: "https://www.lotteon.com/", method: "naver", ...merchant }), "click_provider");
  assert.equal(
    planExternalLoginStep({ pageUrl: "https://nid.naver.com/nidlogin.login", method: "naver", ...merchant }),
    "fill_provider",
  );
  assert.equal(planExternalLoginStep({ pageUrl: "https://example.test/", method: "naver", ...merchant }), "wait");
  assert.equal(
    planExternalLoginStep({ pageUrl: "https://nid.naver.com/nidlogin.login", method: "naver", acted: { fill_provider: true }, ...merchant }),
    "wait",
  );
  // Without merchant domains every page keeps the legacy merchant behavior.
  assert.equal(planExternalLoginStep({ pageUrl: "", method: "password" }), "fill_merchant");
});

test("login wait clicks the provider then fills provider credentials", async () => {
  const clicked = [];
  const filled = [];
  const states = [
    { authenticated: false, blocked: false, hasLoginForm: false, url: "https://www.lotteon.com/p/member/login/common" },
    { authenticated: false, blocked: false, hasLoginForm: true, url: "https://nid.naver.com/nidlogin.login" },
    { authenticated: true, blocked: false, hasLoginForm: false, url: "https://www.lotteon.com/" },
  ];
  const page = {
    async evaluate(expression) {
      const text = String(expression);
      if (text.includes("elementFromPoint")) {
        filled.push(text);
        return true;
      }
      if (text.includes("authenticated") && text.includes("blocked")) return states.shift() || states[states.length - 1];
      if (text.includes('"naver"')) return { provider: { x: 5, y: 5 } };
      return { id: { x: 1, y: 1 }, password: { x: 1, y: 2 }, submit: { x: 1, y: 3 } };
    },
    async clickPoint(point) {
      clicked.push(point);
    },
    async getCookies() {
      return [{ name: "auth", value: "ok" }];
    },
  };
  const result = await waitForExternalLogin({
    page,
    detectControlsScript: "function detect() {}",
    method: "naver",
    merchantDomains: ["lotteon.com"],
    providerCredentials: { loginId: "naver-id", password: "naver-pw" },
    timeoutMs: 5000,
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(clicked[0], { x: 5, y: 5 });
  assert.ok(filled.length >= 2);
});

test("login wait resolves on visible authentication", async () => {
  const page = {
    async evaluate() {
      return { authenticated: true, blocked: false, hasLoginForm: false };
    },
    async getCookies() {
      return [{ name: "session", value: "s3cr3t" }];
    },
  };
  const result = await waitForExternalLogin({ page, timeoutMs: 1000, sleepImpl: async () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cookies.map((cookie) => cookie.name), ["session"]);
});

test("login wait auto-fills saved credentials once, then observes", async () => {
  const calls = [];
  let polls = 0;
  const page = {
    async evaluate(expression) {
      calls.push(String(expression));
      if (expression.includes("elementFromPoint")) return true;
      if (expression.includes("authenticated") && expression.includes("blocked")) {
        polls += 1;
        return { authenticated: polls >= 3, blocked: false, hasLoginForm: true };
      }
      return { id: { x: 1, y: 1 }, password: { x: 1, y: 2 }, submit: { x: 1, y: 3 } };
    },
    async clickPoint() {},
    async getCookies() {
      return [{ name: "auth", value: "ok" }];
    },
  };
  const result = await waitForExternalLogin({
    page,
    detectControlsScript: "function detect() {}",
    credentials: { loginId: "user01", password: "pw01" },
    timeoutMs: 5000,
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(calls.filter((call) => call.includes("elementFromPoint")).length, 2);
});

test("login wait reports blocks, timeouts and cancellation", async () => {
  const blocked = await waitForExternalLogin({
    page: { evaluate: async () => ({ authenticated: false, blocked: true }), getCookies: async () => [] },
    timeoutMs: 1000,
    sleepImpl: async () => {},
  });
  assert.deepEqual([blocked.ok, blocked.code], [false, "LOGIN_BLOCKED"]);

  const timedOut = await waitForExternalLogin({
    page: { evaluate: async () => ({ authenticated: false, blocked: false }), getCookies: async () => [] },
    timeoutMs: 30,
    sleepImpl: async () => {},
  });
  assert.equal(timedOut.code, "LOGIN_TIMEOUT");

  const canceled = await waitForExternalLogin({
    page: { evaluate: async () => { throw new Error("unreachable"); }, getCookies: async () => [] },
    timeoutMs: 1000,
    canceled: () => true,
    sleepImpl: async () => {},
  });
  assert.equal(canceled.code, "LOGIN_CANCELED");

  const unreadable = await waitForExternalLogin({
    page: { evaluate: async () => { throw new Error("gone"); }, getCookies: async () => [] },
    timeoutMs: 10000,
    sleepImpl: async () => {},
  });
  assert.equal(unreadable.code, "LOGIN_PAGE_UNREADABLE");

  assert.equal((await waitForExternalLogin({})).code, "CDP_UNREACHABLE");
});

test("retailer login launches chrome, logs in and always closes it", async () => {
  const spawned = [];
  let killed = 0;
  const spawnImpl = (path, args) => {
    spawned.push({ path, args });
    return { killed: false, kill() { killed += 1; this.killed = true; } };
  };
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/json/version")) throw new Error("ECONNREFUSED");
    if (String(url).endsWith("/json/list")) {
      return { ok: true, json: async () => [{ id: "T", type: "page", webSocketDebuggerUrl: "ws://dbg" }] };
    }
    if (String(url).includes("/json/new")) {
      return { ok: true, json: async () => ({ id: "T", webSocketDebuggerUrl: "ws://dbg" }) };
    }
    throw new Error(`unexpected ${url} ${init?.method}`);
  };
  const Socket = fakeWebSocketClass((socket, text) => {
    const request = JSON.parse(text);
    if (request.method === "Runtime.evaluate") {
      const expression = request.params.expression;
      if (expression.includes("elementFromPoint")) return reply(socket, { id: 1, result: { result: { value: true } } });
      if (expression.includes("authenticated")) {
        return reply(socket, { id: 1, result: { result: { value: { authenticated: true, blocked: false } } } });
      }
      return reply(socket, {
        id: 1,
        result: { result: { value: { id: { x: 1, y: 1 }, password: { x: 1, y: 2 }, submit: { x: 1, y: 3 } } } },
      });
    }
    if (request.method === "Network.getAllCookies") {
      return reply(socket, { id: 1, result: { cookies: [{ name: "auth", value: "ok" }] } });
    }
    return reply(socket, { id: 1, result: {} });
  });
  const result = await startExternalRetailerLogin({
    loginUrl: "https://www.ssg.com/",
    credentials: { loginId: "user01", password: "pw01" },
    chromeExecutable: "C:\\chrome.exe",
    userDataDir: "C:\\data",
    detectControlsScript: "function detect() {}",
    deps: { spawnImpl, fetchImpl, WebSocketImpl: Socket, sleepImpl: async () => {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cookies.map((cookie) => cookie.name), ["auth"]);
  assert.equal(killed, 1);
  assert.ok(spawned[0].args.some((arg) => arg.includes("--remote-debugging-port=")));
  assert.ok(spawned[0].args.some((arg) => arg.includes("--user-data-dir=")));
});

test("retailer login reports launch and connection failures with codes", async () => {
  assert.equal((await startExternalRetailerLogin({ deps: {} })).code, "CHROME_NOT_FOUND");
  const spawnImpl = () => { throw new Error("spawn failed"); };
  const launchFailed = await startExternalRetailerLogin({
    loginUrl: "https://www.ssg.com/",
    chromeExecutable: "C:\\chrome.exe",
    userDataDir: "C:\\data",
    deps: { spawnImpl, fetchImpl: async () => { throw new Error("no"); }, WebSocketImpl: fakeWebSocketClass(), sleepImpl: async () => {} },
  });
  assert.equal(launchFailed.code, "CHROME_LAUNCH_FAILED");

  let killed = 0;
  const hangingSpawn = () => ({ kill() { killed += 1; } });
  const unreachable = await startExternalRetailerLogin({
    loginUrl: "https://www.ssg.com/",
    chromeExecutable: "C:\\chrome.exe",
    userDataDir: "C:\\data",
    deps: {
      spawnImpl: hangingSpawn,
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
      WebSocketImpl: fakeWebSocketClass(),
      sleepImpl: async () => {},
    },
    cdpLaunchTimeoutMs: 60,
  });
  assert.equal(unreachable.code, "CDP_UNREACHABLE");
  assert.equal(killed, 1);
});
