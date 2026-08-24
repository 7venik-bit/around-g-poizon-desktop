import { app } from "electron";
import { spawn } from "node:child_process";

const handledQueries = new Set();

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
      "if($dx -gt 4 -or $dy -gt 4){ throw \"CURSOR_DID_NOT_REACH_TARGET\" }",
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
      return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>=40&&r.height>=30&&r.bottom>60&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
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

    const cards=[...document.querySelectorAll('li,article,[data-product-id],[data-item-id],[class*="product-card" i],[class*="product" i],[class*="item-card" i],[class*="item" i]')];
    const matches=[];
    for(const card of cards){
      if(!visible(card)) continue;
      const links=[...card.querySelectorAll('a[href]')];
      const imgs=[...card.querySelectorAll('img')].filter((img)=>{
        const r=img.getBoundingClientRect();
        return visible(img)&&r.width>=70&&r.height>=70;
      });
      if(!links.length||!imgs.length) continue;
      const evidence=compact([
        card.innerText,
        card.textContent,
        ...links.map((a)=>[a.href,a.textContent,a.getAttribute('aria-label')].join(' ')),
        ...imgs.map((img)=>[img.alt,img.src,img.currentSrc].join(' '))
      ].join(' '));
      if(!evidence.includes(code)) continue;
      const link=links.find((a)=>/window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i.test(String(a.href||'')))||links[0];
      const img=imgs[0];
      const ir=img.getBoundingClientRect();
      const cr=card.getBoundingClientRect();
      matches.push({
        query:searchQuery,
        href:String(link?.href||''),
        x:Math.round(ir.left+ir.width/2),
        y:Math.round(ir.top+Math.min(ir.height/2,180)),
        top:cr.top,
        left:cr.left
      });
    }
    matches.sort((a,b)=>a.top-b.top||a.left-b.left);
    return matches[0]||null;
  })()`, true).catch(() => null);
}

async function openMatchingCardPhysically(window, target) {
  if (!target || !window || window.isDestroyed()) return false;
  window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const settled = await detectMatchingCard(window) || target;
  if (!settled?.query || !settled?.x || !settled?.y) return false;
  if (String(settled.query).trim() !== String(target.query).trim()) return false;

  const before = cleanUrl(window.webContents.getURL());
  const bounds = window.getContentBounds();
  const clicked = await physicalMoveAndClick(bounds.x + settled.x, bounds.y + settled.y);
  if (!clicked) return false;

  for (let i = 0; i < 28; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (window.isDestroyed()) return false;
    const after = cleanUrl(window.webContents.getURL());
    if (after && after !== before) return true;
  }
  return false;
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
      if (handledQueries.has(key)) return;

      const opened = await openMatchingCardPhysically(window, target);
      if (opened) handledQueries.add(key);
    } finally {
      busy = false;
    }
  }, 600);

  window.once("closed", () => clearInterval(timer));
}

app.on("browser-window-created", (_event, window) => install(window));

await import("./recovery-bootstrap.mjs");
