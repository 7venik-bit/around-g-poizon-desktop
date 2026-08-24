import { app } from "electron";
import { spawn } from "node:child_process";

const handledQueries = new Set();
const attemptedQueries = new Set();

function cleanUrl(value) {
  return String(value || "").split("#")[0];
}

function physicalMoveAndClick(x, y) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    const tx = Math.round(Number(x));
    const ty = Math.round(Number(y));
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return resolve(false);

    const ps = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -TypeDefinition @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class MouseNative {",
      "  [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT p);",
      "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
      "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);",
      "  public struct POINT { public int X; public int Y; }",
      "}",
      "'@",
      "$p=New-Object MouseNative+POINT",
      "[MouseNative]::GetCursorPos([ref]$p)|Out-Null",
      `$sx=$p.X; $sy=$p.Y; $tx=${tx}; $ty=${ty}`,
      "$steps=54",
      "for($i=1;$i -le $steps;$i++){",
      "  $t=$i/[double]$steps",
      "  $e=(3*$t*$t)-(2*$t*$t*$t)",
      "  $nx=[int]($sx+(($tx-$sx)*$e))",
      "  $ny=[int]($sy+(($ty-$sy)*$e))",
      "  [MouseNative]::SetCursorPos($nx,$ny)|Out-Null",
      "  Start-Sleep -Milliseconds 32",
      "}",
      "[MouseNative]::SetCursorPos($tx,$ty)|Out-Null",
      "Start-Sleep -Milliseconds 450",
      "$verify=New-Object MouseNative+POINT",
      "[MouseNative]::GetCursorPos([ref]$verify)|Out-Null",
      "$dx=[Math]::Abs($verify.X-$tx)",
      "$dy=[Math]::Abs($verify.Y-$ty)",
      "if($dx -gt 6 -or $dy -gt 6){ throw \"CURSOR_DID_NOT_REACH_TARGET\" }",
      "Start-Sleep -Milliseconds 250",
      "[MouseNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 140",
      "[MouseNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 350"
    ].join("\r\n");

    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Boolean(value));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(false);
    }, 12000);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

async function detectMatchingCard(window) {
  if (!window || window.isDestroyed()) return null;
  return window.webContents.executeJavaScript(`(() => {
    const compact=(value)=>String(value||'').replace(/[^A-Z0-9가-힣]/gi,'').toUpperCase();
    const visible=(el)=>{
      if(!el) return false;
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>=30&&r.height>=24&&r.bottom>60&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
    };

    const currentUrl=String(location.href||'');
    if(!/naver\\.com/i.test(currentUrl)) return null;
    if(/window-products|productId=|nvMid=|itemId=|goodsNo=/i.test(currentUrl) && !/search|query|keyword/i.test(currentUrl)) return null;

    const inputCandidates=[...document.querySelectorAll('input[type="search"],input[name*="query" i],input[placeholder*="검색"],input')]
      .filter((el)=>visible(el))
      .map((el)=>String(el.value||'').trim())
      .filter((value)=>/[A-Z0-9]/i.test(value) && compact(value).length>=4);
    const searchQuery=inputCandidates.find(Boolean)||'';
    const code=compact(searchQuery);
    if(code.length<4) return null;

    const productPattern=/window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
    const anchors=[...document.querySelectorAll('a[href]')].filter((a)=>visible(a) || visible(a.querySelector('img')));
    const matches=[];

    for(const a of anchors){
      const href=String(a.href||'');
      let scope=a;
      let bestScope=a;
      for(let depth=0;scope&&depth<6;depth+=1,scope=scope.parentElement){
        const text=compact([scope.innerText,scope.textContent,scope.getAttribute?.('aria-label')].join(' '));
        if(text.includes(code)) bestScope=scope;
        if(scope.matches?.('li,article,[data-product-id],[data-item-id],[class*="product-card" i],[class*="product" i],[class*="item-card" i],[class*="item" i]')) {
          bestScope=scope;
          break;
        }
      }
      const imgs=[...new Set([
        ...a.querySelectorAll('img'),
        ...(bestScope?.querySelectorAll?.('img')||[])
      ])].filter((img)=>{
        const r=img.getBoundingClientRect();
        return visible(img)&&r.width>=60&&r.height>=60;
      });
      const evidence=compact([
        href,
        a.textContent,
        a.getAttribute('aria-label'),
        bestScope?.innerText,
        bestScope?.textContent,
        bestScope?.getAttribute?.('aria-label'),
        ...imgs.map((img)=>[img.alt,img.src,img.currentSrc].join(' '))
      ].join(' '));
      if(!evidence.includes(code)) continue;
      if(!productPattern.test(href) && !imgs.length) continue;

      const targetImage=imgs[0]||null;
      const rr=targetImage?.getBoundingClientRect?.() || a.getBoundingClientRect();
      if(rr.width<=0||rr.height<=0) continue;
      bestScope?.scrollIntoView?.({block:'center',inline:'center'});
      const settledRect=targetImage?.getBoundingClientRect?.() || a.getBoundingClientRect();
      matches.push({
        query:searchQuery,
        href,
        x:Math.round(settledRect.left+settledRect.width/2),
        y:Math.round(settledRect.top+Math.min(settledRect.height/2,180)),
        top:settledRect.top,
        left:settledRect.left
      });
    }

    matches.sort((a,b)=>(productPattern.test(b.href)?1:0)-(productPattern.test(a.href)?1:0)||a.top-b.top||a.left-b.left);
    return matches[0]||null;
  })()`, true).catch(() => null);
}

async function openMatchingCardPhysically(window, target) {
  if (!target || !window || window.isDestroyed()) return { opened: false, clicked: false, physical: false };
  window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const settled = await detectMatchingCard(window) || target;
  if (!settled?.query || !Number.isFinite(settled?.x) || !Number.isFinite(settled?.y)) {
    return { opened: false, clicked: false, physical: false };
  }
  if (String(settled.query).trim() !== String(target.query).trim()) {
    return { opened: false, clicked: false, physical: false };
  }

  const before = cleanUrl(window.webContents.getURL());
  const bounds = window.getContentBounds();
  const physical = await physicalMoveAndClick(bounds.x + settled.x, bounds.y + settled.y);

  if (!physical && !window.isDestroyed()) {
    window.webContents.sendInputEvent({ type: "mouseMove", x: settled.x, y: settled.y });
    await new Promise((resolve) => setTimeout(resolve, 350));
    window.webContents.sendInputEvent({ type: "mouseDown", x: settled.x, y: settled.y, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    window.webContents.sendInputEvent({ type: "mouseUp", x: settled.x, y: settled.y, button: "left", clickCount: 1 });
  }

  const clicked = physical || true;
  for (let i = 0; i < 28; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (window.isDestroyed()) return { opened: false, clicked, physical };
    const after = cleanUrl(window.webContents.getURL());
    if (after && after !== before) return { opened: true, clicked, physical };
  }
  return { opened: false, clicked, physical };
}

function install(window) {
  const wc = window?.webContents;
  if (!wc || wc.__aroundGObservedPhysicalInstalled) return;
  wc.__aroundGObservedPhysicalInstalled = true;

  let busy = false;
  const timer = setInterval(async () => {
    if (busy || window.isDestroyed()) return;
    const url = String(wc.getURL() || '');
    if (!/naver\\.com/i.test(url)) return;

    busy = true;
    try {
      const target = await detectMatchingCard(window);
      if (!target?.query) return;
      const key = String(target.query).trim().toUpperCase();
      if (handledQueries.has(key) || attemptedQueries.has(key)) return;

      // Lock before clicking. A failed navigation must never cause the same
      // product code to be searched/clicked over and over again.
      attemptedQueries.add(key);
      const result = await openMatchingCardPhysically(window, target);
      if (result.clicked) handledQueries.add(key);
    } finally {
      busy = false;
    }
  }, 600);

  window.once("closed", () => clearInterval(timer));
}

app.on("browser-window-created", (_event, window) => install(window));

await import("./recovery-bootstrap.mjs");
