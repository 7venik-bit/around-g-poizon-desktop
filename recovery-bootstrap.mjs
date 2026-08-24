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
      "$steps=36",
      "for($i=1; $i -le $steps; $i++){",
      "  $t=$i/[double]$steps",
      "  $ease=(3*$t*$t)-(2*$t*$t*$t)",
      "  $nx=[int]($sx + (($tx-$sx)*$ease))",
      "  $ny=[int]($sy + (($ty-$sy)*$ease))",
      "  [MouseNative]::SetCursorPos($nx,$ny) | Out-Null",
      "  Start-Sleep -Milliseconds 28",
      "}",
      "[MouseNative]::SetCursorPos($tx,$ty) | Out-Null",
      "Start-Sleep -Milliseconds 500",
      "[MouseNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 120",
      "[MouseNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 250",
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
    }, 8000);
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0));
  });
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

    if (!result && (isScrollLookup || isPointLookup)) {
      const fallbackScript = `(() => {
        const expected = ${JSON.stringify(expectedUrl)};
        const clean = (value) => String(value || "").split("#")[0];
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden"
            && Number(style.opacity || 1) > 0 && rect.width >= 40 && rect.height >= 30
            && rect.bottom > 60 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
        };
        const productPattern = /window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
        let expectedParsed = null;
        try { expectedParsed = new URL(expected); } catch {}
        const expectedIds = expectedParsed
          ? ["productId", "nvMid", "itemId", "goodsNo"].map((name) => expectedParsed.searchParams.get(name)).filter(Boolean)
          : [];
        const candidates = [...document.querySelectorAll("a[href]")].map((anchor) => {
          const card = anchor.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]") || anchor.parentElement || anchor;
          const image = anchor.querySelector("img,picture img") || card.querySelector?.("img,picture img");
          const cardRect = card.getBoundingClientRect();
          const imageRect = image?.getBoundingClientRect?.() || { width: 0, height: 0 };
          const href = clean(anchor.href);
          let score = 0;
          if (href === clean(expected)) score += 10000;
          try {
            const left = new URL(href);
            if (expectedParsed && left.origin === expectedParsed.origin && left.pathname === expectedParsed.pathname) score += 7000;
            if (expectedIds.some((id) => href.includes(id))) score += 6000;
          } catch {}
          if (productPattern.test(href)) score += 1500;
          if (image && imageRect.width >= 70 && imageRect.height >= 70) score += 1000;
          if (cardRect.width >= 120 && cardRect.height >= 100) score += 500;
          if (visible(anchor) || visible(card)) score += 300;
          return { anchor, card, image, cardRect, imageRect, score };
        }).filter((item) => item.score >= 1500)
          .sort((a, b) => b.score - a.score || a.cardRect.top - b.cardRect.top || a.cardRect.left - b.cardRect.left);
        const selected = candidates[0];
        if (!selected) return ${isScrollLookup ? "false" : "null"};
        selected.card.scrollIntoView({ block: "center", inline: "center" });
        if (${isScrollLookup ? "true" : "false"}) return true;
        const cardRect = selected.card.getBoundingClientRect();
        const imageRect = selected.image?.getBoundingClientRect?.();
        const clickRect = imageRect && imageRect.width >= 50 && imageRect.height >= 50 ? imageRect : cardRect;
        if (clickRect.width <= 0 || clickRect.height <= 0) return null;
        return { x: Math.round(clickRect.left + clickRect.width / 2), y: Math.round(clickRect.top + Math.min(clickRect.height / 2, 180)), forcedPhysical: true };
      })()`;
      result = await nativeExecuteJavaScript(fallbackScript, true).catch(() => null);
    }

    if (key && isScrollLookup && result) naverProductClickState.set(key, "pending");

    if (isPointLookup && result && Number.isFinite(result.x) && Number.isFinite(result.y)) {
      try {
        window.show();
        window.restore();
        window.focus();
        await new Promise((resolve) => setTimeout(resolve, 350));
        const bounds = window.getContentBounds();
        const clicked = await moveWindowsCursorAndClick(bounds.x + result.x, bounds.y + result.y);
        if (clicked && key) naverProductClickState.set(key, "done");
        return clicked ? { ...result, physicallyClicked: true } : result;
      } catch {
        return result;
      }
    }

    return result;
  };
}

app.on("browser-window-created", (_event, window) => {
  installNaverProductClickGuard(window);
});

await import("./bootstrap.mjs");
