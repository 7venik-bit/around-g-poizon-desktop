import { app } from "electron";
import { spawn } from "node:child_process";

const naverProductClickState = new Map();

function cleanUrl(value) {
  return String(value || "").split("#")[0];
}

function productKey(value) {
  const raw = cleanUrl(value);
  try {
    const url = new URL(raw);
    const stableParams = ["productId", "nvMid", "itemId", "goodsNo"]
      .map((name) => [name, url.searchParams.get(name)])
      .filter(([, value]) => value);
    if (stableParams.length) {
      return `${url.origin}${url.pathname}?${stableParams.map(([name, value]) => `${name}=${value}`).join("&")}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
}

function expectedUrlFromScript(source) {
  const match = String(source || "").match(/const expected = ("(?:\\.|[^"\\])*");/);
  if (!match) return "";
  try { return JSON.parse(match[1]); } catch { return ""; }
}

function moveWindowsCursorAndClick(screenX, screenY) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    const x = Math.round(Number(screenX));
    const y = Math.round(Number(screenY));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return resolve(false);

    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -TypeDefinition @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class MouseNative {",
      "  [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT lpPoint);",
      "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
      "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);",
      "  public struct POINT { public int X; public int Y; }",
      "}",
      "'@",
      "$p = New-Object MouseNative+POINT",
      "[MouseNative]::GetCursorPos([ref]$p) | Out-Null",
      `$sx=$p.X; $sy=$p.Y; $tx=${x}; $ty=${y}`,
      "$steps=42",
      "for($i=1; $i -le $steps; $i++){",
      "  $t=$i/[double]$steps",
      "  $ease=(3*$t*$t)-(2*$t*$t*$t)",
      "  $nx=[int]($sx + (($tx-$sx)*$ease))",
      "  $ny=[int]($sy + (($ty-$sy)*$ease))",
      "  [MouseNative]::SetCursorPos($nx,$ny) | Out-Null",
      "  Start-Sleep -Milliseconds 30",
      "}",
      "[MouseNative]::SetCursorPos($tx,$ty) | Out-Null",
      "Start-Sleep -Milliseconds 700",
      "[MouseNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 140",
      "[MouseNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 300",
    ].join("\r\n");

    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Boolean(value));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      done(false);
    }, 10000);
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0));
  });
}

async function findVisibleNaverProductCard(window, expectedUrl = "") {
  if (!window || window.isDestroyed()) return null;
  const contents = window.webContents;
  const expected = cleanUrl(expectedUrl);
  return contents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(expected)};
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && r.width >= 60 && r.height >= 60
        && r.bottom > 70 && r.top < innerHeight
        && r.right > 0 && r.left < innerWidth;
    };
    const productPattern = /window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
    const bodyText = String(document.body?.innerText || '');
    if (!/브랜드직영몰|공식브랜드|브랜드스토어|백화점|아울렛|패션타운/.test(bodyText)) return null;
    const rows = [...document.querySelectorAll('a[href]')].map((a) => {
      const href = String(a.href || '').split('#')[0];
      const card = a.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]") || a.parentElement || a;
      const img = a.querySelector('img') || card.querySelector?.('img');
      const ar = a.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      const ir = img?.getBoundingClientRect?.() || {width:0,height:0,left:0,top:0};
      let score = 0;
      if (expected && href === expected) score += 10000;
      try {
        const l = new URL(href);
        const e = expected ? new URL(expected) : null;
        if (e && l.origin === e.origin && l.pathname === e.pathname) score += 7000;
      } catch {}
      if (productPattern.test(href)) score += 1800;
      if (img && ir.width >= 80 && ir.height >= 80) score += 1400;
      if (visible(card)) score += 700;
      if (visible(a)) score += 300;
      if (cr.width >= 140 && cr.height >= 120) score += 300;
      return { href, card, img, ar, cr, ir, score };
    }).filter((x) => x.score >= 2500)
      .sort((a,b) => b.score - a.score || a.cr.top - b.cr.top || a.cr.left - b.cr.left);
    const selected = rows[0];
    if (!selected) return null;
    selected.card.scrollIntoView({block:'center', inline:'center'});
    const ir = selected.img?.getBoundingClientRect?.();
    const cr = selected.card.getBoundingClientRect();
    const rr = ir && ir.width >= 60 && ir.height >= 60 ? ir : cr;
    if (rr.width <= 0 || rr.height <= 0) return null;
    return {
      href: selected.href,
      x: Math.round(rr.left + rr.width / 2),
      y: Math.round(rr.top + Math.min(rr.height / 2, 180))
    };
  })()`, true).catch(() => null);
}

async function physicallyOpenNaverCard(window, expectedUrl = "") {
  if (!window || window.isDestroyed()) return false;
  if (window.__aroundGPhysicalClickInProgress) return false;
  window.__aroundGPhysicalClickInProgress = true;
  try {
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
    await new Promise((resolve) => setTimeout(resolve, 500));

    let target = await findVisibleNaverProductCard(window, expectedUrl);
    if (!target) return false;
    await new Promise((resolve) => setTimeout(resolve, 650));
    target = await findVisibleNaverProductCard(window, expectedUrl) || target;

    const beforeUrl = cleanUrl(window.webContents.getURL());
    const bounds = window.getContentBounds();
    const clicked = await moveWindowsCursorAndClick(bounds.x + target.x, bounds.y + target.y);
    if (!clicked) return false;

    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (window.isDestroyed()) return false;
      const afterUrl = cleanUrl(window.webContents.getURL());
      if (afterUrl && afterUrl !== beforeUrl) {
        const key = productKey(target.href || expectedUrl);
        if (key) naverProductClickState.set(key, "done");
        return true;
      }
    }
    return false;
  } finally {
    window.__aroundGPhysicalClickInProgress = false;
  }
}

function installNaverProductClickGuard(window) {
  const contents = window?.webContents;
  if (!contents || contents.__aroundGNaverClickGuardInstalled) return;
  contents.__aroundGNaverClickGuardInstalled = true;

  const nativeExecuteJavaScript = contents.executeJavaScript.bind(contents);
  contents.executeJavaScript = async (code, userGesture) => {
    const source = String(code || "");
    const isRenderedProductCardLookup =
      source.includes('document.querySelectorAll("a[href]")')
      && source.includes('const expected = ')
      && (source.includes('scrollIntoView') || source.includes('getBoundingClientRect'));

    if (!isRenderedProductCardLookup) {
      return nativeExecuteJavaScript(code, userGesture);
    }

    const expectedUrl = expectedUrlFromScript(source);
    const key = productKey(expectedUrl);
    const isScrollLookup = source.includes("scrollIntoView");
    const isPointLookup = source.includes("getBoundingClientRect") && !isScrollLookup;
    const state = naverProductClickState.get(key) || "new";

    if (key && state === "done") {
      return isScrollLookup ? false : isPointLookup ? null : nativeExecuteJavaScript(code, userGesture);
    }

    let result = await nativeExecuteJavaScript(code, userGesture).catch(() => null);

    if (isScrollLookup) {
      const card = await findVisibleNaverProductCard(window, expectedUrl);
      if (card) {
        if (key) naverProductClickState.set(key, "pending");
        return true;
      }
      return result;
    }

    if (isPointLookup) {
      const card = await findVisibleNaverProductCard(window, expectedUrl);
      if (card) {
        const opened = await physicallyOpenNaverCard(window, expectedUrl);
        if (opened) return { x: card.x, y: card.y, physicallyClicked: true };
        return { x: card.x, y: card.y };
      }
    }

    return result;
  };

  let observerBusy = false;
  const observer = setInterval(async () => {
    if (observerBusy || window.isDestroyed()) return;
    const currentUrl = String(contents.getURL() || "");
    if (!/naver\.com/i.test(currentUrl)) return;
    observerBusy = true;
    try {
      if (window.__aroundGPhysicalClickInProgress) return;
      const target = await findVisibleNaverProductCard(window, "");
      if (!target) return;
      const key = productKey(target.href);
      if (key && naverProductClickState.get(key) === "done") return;
      const pageState = await nativeExecuteJavaScript(`(() => ({
        detail: /window-products|productId=|nvMid=|itemId=|goodsNo=/i.test(location.href),
        hasSearchResult: /브랜드직영몰|공식브랜드|브랜드스토어|백화점|아울렛|패션타운/.test(String(document.body?.innerText || ''))
      }))()`, true).catch(() => null);
      if (!pageState?.hasSearchResult || pageState.detail) return;
    } finally {
      observerBusy = false;
    }
  }, 700);
  window.once("closed", () => clearInterval(observer));
}

app.on("browser-window-created", (_event, window) => {
  installNaverProductClickGuard(window);
});

await import("./bootstrap.mjs");
