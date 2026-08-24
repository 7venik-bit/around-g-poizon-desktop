import { app } from "electron";
import { spawn } from "node:child_process";

function cleanUrl(value) {
  return String(value || "").split("#")[0];
}

function expectedUrlFromScript(source) {
  const match = String(source || "").match(/const expected = ("(?:\\.|[^"\\])*");/);
  if (!match) return "";
  try { return JSON.parse(match[1]); } catch { return ""; }
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
      "$steps=48",
      "for($i=1;$i -le $steps;$i++){",
      " $t=$i/[double]$steps",
      " $e=(3*$t*$t)-(2*$t*$t*$t)",
      " $nx=[int]($sx+(($tx-$sx)*$e))",
      " $ny=[int]($sy+(($ty-$sy)*$e))",
      " [MouseNative]::SetCursorPos($nx,$ny)|Out-Null",
      " Start-Sleep -Milliseconds 30",
      "}",
      "[MouseNative]::SetCursorPos($tx,$ty)|Out-Null",
      "Start-Sleep -Milliseconds 700",
      "[MouseNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 150",
      "[MouseNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 300"
    ].join("\r\n");

    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(false);
    }, 10000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

async function locateCard(window, expectedUrl) {
  const expected = cleanUrl(expectedUrl);
  return window.webContents.executeJavaScript(`(() => {
    const expected=${JSON.stringify(expected)};
    const visible=(el)=>{
      if(!el) return false;
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>=60&&r.height>=60&&r.bottom>70&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
    };
    const productPattern=/window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
    const candidates=[...document.querySelectorAll('a[href]')].map(a=>{
      const href=String(a.href||'').split('#')[0];
      const card=a.closest("li,article,[data-product-id],[data-item-id],[class*='product-card' i],[class*='product' i],[class*='item-card' i],[class*='item' i]")||a.parentElement||a;
      const img=a.querySelector('img')||card.querySelector?.('img');
      const cr=card.getBoundingClientRect();
      const ir=img?.getBoundingClientRect?.()||{width:0,height:0};
      let score=0;
      if(expected&&href===expected) score+=10000;
      try{const l=new URL(href),e=expected?new URL(expected):null;if(e&&l.origin===e.origin&&l.pathname===e.pathname) score+=7000;}catch{}
      if(productPattern.test(href)) score+=1800;
      if(img&&ir.width>=80&&ir.height>=80) score+=1600;
      if(visible(card)) score+=800;
      if(visible(a)) score+=300;
      return {a,card,img,cr,score,href};
    }).filter(x=>x.score>=2600).sort((a,b)=>b.score-a.score||a.cr.top-b.cr.top||a.cr.left-b.cr.left);
    const s=candidates[0];
    if(!s) return null;
    s.card.scrollIntoView({block:'center',inline:'center'});
    const ir=s.img?.getBoundingClientRect?.();
    const cr=s.card.getBoundingClientRect();
    const r=ir&&ir.width>=60&&ir.height>=60?ir:cr;
    if(r.width<=0||r.height<=0) return null;
    return {href:s.href,x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(r.height/2,180))};
  })()`, true).catch(() => null);
}

function install(window) {
  const wc = window?.webContents;
  if (!wc || wc.__aroundGDirectPhysicalInstalled) return;
  wc.__aroundGDirectPhysicalInstalled = true;
  const nativeExec = wc.executeJavaScript.bind(wc);

  wc.executeJavaScript = async (code, userGesture) => {
    const source = String(code || "");
    const pointLookup = source.includes('document.querySelectorAll("a[href]")')
      && source.includes('const expected = ')
      && source.includes('getBoundingClientRect')
      && !source.includes('scrollIntoView');

    if (!pointLookup) return nativeExec(code, userGesture);

    const expected = expectedUrlFromScript(source);
    const result = await nativeExec(code, userGesture).catch(() => null);
    const card = await locateCard(window, expected);
    if (!card || window.__aroundGDirectPhysicalBusy) return result;

    window.__aroundGDirectPhysicalBusy = true;
    try {
      window.show();
      if (window.isMinimized()) window.restore();
      window.focus();
      await new Promise((r) => setTimeout(r, 500));
      const settledCard = await locateCard(window, expected) || card;
      const bounds = window.getContentBounds();
      const before = cleanUrl(wc.getURL());
      const clicked = await physicalMoveAndClick(bounds.x + settledCard.x, bounds.y + settledCard.y);
      if (!clicked) return result || { x: settledCard.x, y: settledCard.y };

      for (let i = 0; i < 24; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        if (window.isDestroyed()) break;
        const after = cleanUrl(wc.getURL());
        if (after && after !== before) {
          return { x: settledCard.x, y: settledCard.y, physicallyClicked: true, detailOpened: true };
        }
      }
      return { x: settledCard.x, y: settledCard.y, physicallyClicked: true };
    } finally {
      window.__aroundGDirectPhysicalBusy = false;
    }
  };
}

app.on("browser-window-created", (_event, window) => install(window));

await import("./recovery-bootstrap.mjs");
