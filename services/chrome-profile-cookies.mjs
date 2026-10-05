import { dirname, join } from "node:path";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { normalizeCookieEntry } from "./browser-cookie-import.mjs";

// One-click Chrome cookie import: copy the operator's own Chrome profile
// cookies (with their consent, via an explicit button) into a staging area,
// read them through a locally launched Chrome DevTools session, and hand the
// retailer-scoped entries to the search session. The operator's live Chrome
// profile is never written to. Pure helpers below are unit tested; process
// launch and CDP wiring live in main.
export function chromeUserDataDir(env = {}) {
  const localAppData = String(env.LOCALAPPDATA || "");
  if (!localAppData) return "";
  return join(localAppData, "Google", "Chrome", "User Data");
}

export function chromeExecutableCandidates(env = {}) {
  const localAppData = String(env.LOCALAPPDATA || "");
  const programFiles = String(env.ProgramFiles || String(env.ProgramW6432 || ""));
  const programFilesX86 = String(env["ProgramFiles(x86)"] || "");
  return [
    localAppData && join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    programFiles && join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 && join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
}

export function findChromeExecutable(existsSync, candidates = []) {
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      // Ignore a single unreadable candidate and try the next one.
    }
  }
  return "";
}

const PROFILE_FILES = [
  "Cookies",
  "Cookies-journal",
  "Preferences",
  "Secure Preferences",
  "Network/Cookies",
  "Network/Cookies-journal",
];

export function chromeProfileCopyPlan(userDataDir = "", profileName = "Default", stagingRoot = "") {
  const root = String(userDataDir || "");
  const profile = String(profileName || "Default");
  const staging = String(stagingRoot || "");
  if (!root || !staging) return { files: [], localState: "" };
  const files = PROFILE_FILES.map((relative) => ({
    src: join(root, profile, relative),
    dst: join(staging, profile, relative),
  }));
  return { files, localState: join(root, "Local State"), localStateDst: join(staging, "Local State") };
}

export function chromeProfileNamesToTry() {
  return ["Default", "Profile 1", "Profile 2", "Profile 3"];
}

// DevTools Network.getAllCookies entries use `expires` (seconds). Fold them
// through the same retailer-domain validation as pasted exports.
export function normalizeChromeCookieEntries(entries = [], allowedDomains = []) {
  const cookies = [];
  let rejected = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") {
      rejected += 1;
      continue;
    }
    const cookie = normalizeCookieEntry({
      name: entry.name,
      value: entry.value,
      domain: entry.domain,
      path: entry.path,
      secure: entry.secure,
      httpOnly: entry.httpOnly,
      expirationDate: entry.expires,
    }, allowedDomains);
    if (!cookie) {
      rejected += 1;
      continue;
    }
    cookies.push(cookie);
  }
  return { cookies, rejected };
}

export function chromeHeadlessArguments(userDataDir = "", profileName = "Default", port = 0) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileName}`,
    `--remote-debugging-port=${Number(port) || 0}`,
    "--remote-allow-origins=*",
    "about:blank",
  ];
}

// Launch a disposable headless Chrome on a COPIED profile (the live profile
// is never touched) and read its whole cookie store over DevTools. No site is
// visited. Returns { cookies, staging } — the caller removes staging.
export async function readChromeStagingCookies(chromeExe = "", userDataDir = "", profileName = "Default", options = {}) {
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || 20000;
  if (!chromeExe || !userDataDir) throw new Error("CHROME_PROFILE_MISSING");
  if (typeof WebSocketImpl !== "function" || typeof fetchImpl !== "function") {
    throw new Error("CHROME_CDP_UNAVAILABLE");
  }
  const staging = options.stagingRoot
    ? join(String(options.stagingRoot), "around-g-chrome")
    : join(tmpdir(), `around-g-chrome-${process.pid}-${Date.now()}`);
  const plan = chromeProfileCopyPlan(userDataDir, profileName, staging);
  let copied = false;
  for (const file of [...plan.files, { src: plan.localState, dst: plan.localStateDst }]) {
    try {
      if (!file.src || !existsSync(file.src)) continue;
      mkdirSync(dirname(file.dst), { recursive: true });
      cpSync(file.src, file.dst);
      copied = true;
    } catch { /* a single unreadable file must not stop the import */ }
  }
  if (!copied) throw new Error("CHROME_PROFILE_MISSING");
  const child = spawn(chromeExe, chromeHeadlessArguments(staging, profileName, 0),
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  try {
    const debuggerUrl = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("CHROME_DEVTOOLS_TIMEOUT")), timeoutMs);
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/ws:\/\/127\.0\.0\.1:\d+\S*/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", () => { clearTimeout(timer); reject(new Error("CHROME_EXITED_EARLY")); });
    });
    const port = Number(new URL(debuggerUrl).port || 0);
    if (!port) throw new Error("CHROME_DEVTOOLS_TIMEOUT");
    const targets = await fetchImpl(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = (Array.isArray(targets) ? targets : []).find((target) => target?.type === "page")
      || (Array.isArray(targets) ? targets : [])[0];
    if (!page?.webSocketDebuggerUrl) throw new Error("CHROME_TARGET_MISSING");
    const socket = new WebSocketImpl(page.webSocketDebuggerUrl);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CHROME_DEVTOOLS_TIMEOUT")), timeoutMs);
        socket.onmessage = (event) => {
          let payload = null;
          try {
            payload = JSON.parse(String(event?.data ?? ""));
          } catch {
            return;
          }
          if (payload?.id !== 1) return;
          clearTimeout(timer);
          resolve(Array.isArray(payload?.result?.cookies) ? payload.result.cookies : []);
        };
        socket.onerror = () => { clearTimeout(timer); reject(new Error("CHROME_DEVTOOLS_TIMEOUT")); };
        socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
      });
    } finally {
      try { socket.close(); } catch {}
    }
  } finally {
    try { child.kill(); } catch {}
  }
}
