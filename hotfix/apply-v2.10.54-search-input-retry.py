from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
main_path = ROOT / "main.mjs"
renderer_path = ROOT / "src" / "renderer.js"
package_path = ROOT / "package.json"
lock_path = ROOT / "package-lock.json"
tests_dir = ROOT / "tests"

main = main_path.read_text(encoding="utf-8")
renderer = renderer_path.read_text(encoding="utf-8")

# Track the frame that actually owns the POIZON product-search interface.
old_global = 'let brandWorkSessionGeneration = 0;\n'
new_global = 'let brandWorkSessionGeneration = 0;\nlet sellerProductFrameRoutingId = null;\n'
if old_global not in main:
    raise SystemExit("brand work global marker not found")
main = main.replace(old_global, new_global, 1)

# Shared frame helpers. POIZON sometimes renders the goods search UI in a child frame.
marker = 'function sellerBrandExportFailureMessage(code = "", brandName = "") {'
helpers = r'''function sellerWindowFrames() {
  if (!sellerWindow || sellerWindow.isDestroyed()) return [];
  const mainFrame = sellerWindow.webContents.mainFrame;
  return [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
}

function currentSellerProductFrame() {
  const frames = sellerWindowFrames();
  return frames.find((frame) => frame.routingId === sellerProductFrameRoutingId)
    || frames[0]
    || null;
}

'''
if marker not in main:
    raise SystemExit("failure-message marker not found")
main = main.replace(marker, helpers + marker, 1)

# Explain the new error codes instead of exposing only raw internal codes.
old_messages = '  const messages = {\n    BRAND_INPUT_NOT_APPLIED:'
new_messages = '''  const messages = {
    SEARCH_INPUT_NOT_FOUND: `${label} 상품검색 입력창이 4회 재시도 후에도 표시되지 않았습니다. 판매자센터 화면 로딩 또는 로그인 상태를 확인해 주세요.`,
    SELLER_LOGIN_REQUIRED: `${label} 작업 중 판매자센터 로그인 화면이 확인됐습니다. 로그인 후 다시 실행해 주세요.`,
    SELLER_SEARCH_SCRIPT_ERROR: `${label} 상품검색 화면 제어 중 오류가 발생했습니다. 상품검색 화면을 다시 열어 재시도해 주세요.`,
    BRAND_INPUT_NOT_APPLIED:'''
if old_messages not in main:
    raise SystemExit("failure message map marker not found")
main = main.replace(old_messages, new_messages, 1)

start = main.index('async function automateSellerBrandExport(input = {})')
end = main.index('async function syncBrandCatalogFromKrPoizon', start)
workflow = main[start:end]

# Allow SPA controls more time to mount before the first attempt.
old_wait = '  await new Promise((resolve) => setTimeout(resolve, 1800));\n  const sellerBrandMatchKeys'
new_wait = '  await new Promise((resolve) => setTimeout(resolve, 3500));\n  const sellerBrandMatchKeys'
if old_wait not in workflow:
    raise SystemExit("initial seller search wait marker not found")
workflow = workflow.replace(old_wait, new_wait, 1)

# Convert the one-shot main-frame script into a callable frame script.
old_exec = '  const searched = await sellerWindow.webContents.executeJavaScript(`(async () => {'
new_exec = '  const runSellerSearch = (targetFrame) => targetFrame.executeJavaScript(`(async () => {'
if old_exec not in workflow:
    raise SystemExit("seller search execute marker not found")
workflow = workflow.replace(old_exec, new_exec, 1)

# Broaden and rank search input candidates, including shadow roots and localized placeholders.
old_input = '''        const inputs = [...document.querySelectorAll("input")].filter(visible);
        const searchInputs = inputs.filter((element) => {
          const type = String(element.type || "text").toLowerCase();
          return ["text", "search", ""].includes(type);
        });
        const input = searchInputs.find((element) =>
          /상품|브랜드|검색/.test(String(element.placeholder || ""))
        ) || searchInputs
          .filter((element) => element.getBoundingClientRect().top < 180)
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
          || searchInputs[0];
        if (!input) return { ok: false, step: "SEARCH_INPUT_NOT_FOUND" };'''
new_input = '''        const roots = [document];
        for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
          const root = roots[rootIndex];
          for (const element of root.querySelectorAll("*")) {
            if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
          }
        }
        const inputs = roots.flatMap((root) => [...root.querySelectorAll("input, textarea")])
          .filter((element, index, all) => all.indexOf(element) === index)
          .filter(visible)
          .filter((element) => {
            const type = String(element.type || "text").toLowerCase();
            return !element.disabled && !element.readOnly
              && !["hidden", "password", "date", "datetime-local", "month", "time", "file", "checkbox", "radio"].includes(type);
          });
        const inputScore = (element) => {
          const rect = element.getBoundingClientRect();
          const attributes = [
            element.placeholder,
            element.getAttribute("aria-label"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("data-placeholder"),
          ].filter(Boolean).join(" ");
          const context = textOf(element.closest("form, .ant-form-item, [class*='form'], [class*='search']") || element.parentElement);
          const strongHint = /상품|상품명|브랜드|품번|검색|product|brand|article|spu|sku|商品|品牌|货号|搜索|查询/i.test(attributes);
          const contextHint = /상품|브랜드|품번|검색|product|brand|spu|sku|商品|品牌|货号/i.test(context);
          return (strongHint ? 1000 : 0)
            + (contextHint ? 300 : 0)
            + (rect.top >= 0 && rect.top < 360 ? 120 : 0)
            + Math.min(180, Math.round(rect.width));
        };
        const searchInputs = inputs.map((element) => ({ element, score: inputScore(element) }))
          .sort((left, right) => right.score - left.score);
        const input = searchInputs[0]?.element || null;
        if (!input || searchInputs[0].score < 200) {
          return { ok: false, step: "SEARCH_INPUT_NOT_FOUND", inputCount: inputs.length };
        }'''
if old_input not in workflow:
    raise SystemExit("search input selection block not found")
workflow = workflow.replace(old_input, new_input, 1)

old_setter = '''        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(input, "");
        else input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(120);
        if (setter) setter.call(input, ${JSON.stringify(brandName)});
        else input.value = ${JSON.stringify(brandName)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(250);'''
new_setter = '''        const valuePrototype = input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(valuePrototype, "value")?.set;
        const applyValue = (value) => {
          input.focus();
          if (setter) setter.call(input, value);
          else input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        };
        applyValue("");
        await wait(160);
        applyValue(${JSON.stringify(brandName)});
        await wait(350);'''
if old_setter not in workflow:
    raise SystemExit("search input setter block not found")
workflow = workflow.replace(old_setter, new_setter, 1)

old_button_pattern = '/검색\\\\s*및\\\\s*입찰|^검색$/.test(String(element.innerText || element.textContent || "").trim())'
new_button_pattern = '/검색\\\\s*및\\\\s*입찰|^검색$|^검색하기$|搜索|查询|search/i.test(String(element.innerText || element.textContent || "").trim())'
if old_button_pattern not in workflow:
    raise SystemExit("search button pattern marker not found")
workflow = workflow.replace(old_button_pattern, new_button_pattern, 1)

# After defining the page script, execute it against the best available frame and retry page loading.
old_end = '  })()`, true);\n  if (!searched?.ok) {'
new_end = r'''  })()`, true);
  let searched = null;
  let lastSearchDiagnostics = null;
  for (let searchInputAttempt = 1; searchInputAttempt <= 4; searchInputAttempt += 1) {
    const frames = sellerWindowFrames();
    const frameCandidates = [];
    for (const frame of frames) {
      try {
        const probe = await frame.executeJavaScript(`(() => {
          const visible = (element) => element && element.getClientRects().length > 0;
          const inputs = [...document.querySelectorAll("input, textarea")].filter(visible)
            .filter((element) => !element.disabled && !element.readOnly);
          const body = String(document.body?.innerText || "").slice(0, 1200);
          const hint = /상품|브랜드|품번|검색|SPU|SKU|product|brand|商品|品牌|货号|搜索/i.test(body);
          return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            inputCount: inputs.length,
            hint,
            login: /login|signin|passport/i.test(location.href),
          };
        })()`, true);
        frameCandidates.push({ frame, probe });
      } catch {
        // Cross-origin or detached frames are ignored.
      }
    }
    frameCandidates.sort((left, right) =>
      Number(right.probe?.inputCount > 0) - Number(left.probe?.inputCount > 0)
      || Number(right.probe?.hint) - Number(left.probe?.hint)
      || Number(right.frame.routingId === sellerWindow.webContents.mainFrame.routingId)
        - Number(left.frame.routingId === sellerWindow.webContents.mainFrame.routingId)
    );
    const loginFrame = frameCandidates.find((candidate) => candidate.probe?.login);
    if (loginFrame) {
      searched = { ok: false, step: "SELLER_LOGIN_REQUIRED", diagnostics: loginFrame.probe };
      break;
    }
    for (const candidate of frameCandidates) {
      if (!candidate.probe?.inputCount && !candidate.probe?.hint) continue;
      const result = await runSellerSearch(candidate.frame).catch((error) => ({
        ok: false,
        step: "SELLER_SEARCH_SCRIPT_ERROR",
        detail: String(error?.message || error || ""),
      }));
      lastSearchDiagnostics = candidate.probe;
      if (result?.ok) {
        searched = result;
        sellerProductFrameRoutingId = candidate.frame.routingId;
        break;
      }
      if (result?.step !== "SEARCH_INPUT_NOT_FOUND") {
        searched = result;
        break;
      }
      searched = result;
    }
    if (searched?.ok || (searched?.step && searched.step !== "SEARCH_INPUT_NOT_FOUND")) break;
    mainWindow?.webContents.send("brand-export:progress", {
      status: "retrying-search-input",
      brandName,
      jobState: `1단계/5 · 검색 입력창 재탐색 ${searchInputAttempt}/4`,
      message: `${brandName} · 판매자센터 검색 입력창이 아직 표시되지 않아 상품검색 화면을 다시 열고 재시도합니다. (${searchInputAttempt}/4)`,
    });
    if (searchInputAttempt < 4) {
      await sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 2500 + searchInputAttempt * 1000));
    }
  }
  if (!searched?.ok && searched?.step === "SEARCH_INPUT_NOT_FOUND") {
    searched = { ...searched, diagnostics: lastSearchDiagnostics };
  }
  if (!searched?.ok) {'''
if old_end not in workflow:
    raise SystemExit("seller search script closing marker not found")
workflow = workflow.replace(old_end, new_end, 1)

main = main[:start] + workflow + main[end:]

# Ensure page verification runs in the same frame where search succeeded.
verify_start = main.index('async function verifyCompleteSellerExportAndClick')
verify_end = main.index('async function automateSellerBrandExport', verify_start)
verify_block = main[verify_start:verify_end]
old_verify_exec = '  return sellerWindow.webContents.executeJavaScript(`(async () => {'
new_verify_exec = '''  const productFrame = currentSellerProductFrame();
  if (!productFrame) return { ok: false, code: "PRODUCT_PAGE_NOT_READY" };
  return productFrame.executeJavaScript(`(async () => {'''
if old_verify_exec not in verify_block:
    raise SystemExit("product verification frame marker not found")
verify_block = verify_block.replace(old_verify_exec, new_verify_exec, 1)
main = main[:verify_start] + verify_block + main[verify_end:]

# Renderer: keep the remaining selected brands instead of deleting the queue.
old_queue_global = 'let brandExportQueue = [];\nlet activeExportBrand = null;'
new_queue_global = 'let brandExportQueue = [];\nlet brandExportFailureCount = 0;\nlet activeExportBrand = null;'
if old_queue_global not in renderer:
    raise SystemExit("renderer queue global marker not found")
renderer = renderer.replace(old_queue_global, new_queue_global, 1)

old_empty = '''  if (!brandExportQueue.length) {
    activeExportBrand = null;
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = `${brandExportJobs.size}개 브랜드 작업 등록 완료 · 작업번호별 동시 감시를 시작합니다.`;
    if (!brandExportJobs.size) stopBrandActivity();
    else touchBrandActivity("POIZON 파일 처리 상태 자동 감시 중");
    await window.aroundG.startSellerBrandExportMonitor();
    return;
  }'''
new_empty = '''  if (!brandExportQueue.length) {
    activeExportBrand = null;
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    const failureCount = brandExportFailureCount;
    $("#brand-status").className = failureCount ? "status error" : "status success";
    $("#brand-status").textContent = failureCount
      ? `${brandExportJobs.size}개 브랜드 작업 등록 · ${failureCount}개 브랜드 실패 · 등록된 작업 감시를 계속합니다.`
      : `${brandExportJobs.size}개 브랜드 작업 등록 완료 · 작업번호별 동시 감시를 시작합니다.`;
    brandExportFailureCount = 0;
    if (!brandExportJobs.size) stopBrandActivity();
    else touchBrandActivity("POIZON 파일 처리 상태 자동 감시 중");
    await window.aroundG.startSellerBrandExportMonitor();
    return;
  }'''
if old_empty not in renderer:
    raise SystemExit("renderer empty queue block not found")
renderer = renderer.replace(old_empty, new_empty, 1)

old_failure = '''  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    const failedBrandName = activeExportBrand?.name || "선택 브랜드";
    brandExportQueue = [];
    activeExportBrand = null;
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = `${failedBrandName} 작업 실패 · 나머지 선택 브랜드 자동 실행을 중단했습니다. · ${automation?.message || "판매자센터 데이터 가져오기 작업이 생성되지 않았습니다."}`;
    if (brandExportJobs.size) {
      touchBrandActivity("이미 등록된 작업만 계속 감시 중");
      await window.aroundG.startSellerBrandExportMonitor();
    } else {
      stopBrandActivity();
    }
    return;
  } else {'''
new_failure = '''  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    const failedBrandName = activeExportBrand?.name || "선택 브랜드";
    const failureCode = String(automation?.code || "");
    const remainingCount = brandExportQueue.length;
    brandExportFailureCount += 1;
    activeExportBrand = null;
    if (failureCode === "SELLER_LOGIN_REQUIRED") {
      brandExportQueue = [];
      brandSelectionBusy = false;
      renderBrandCards($("#brand-filter")?.value || "");
      $("#brand-status").className = "status error";
      $("#brand-status").textContent = `${failedBrandName} 작업 중 판매자센터 로그인이 필요합니다. 로그인 후 다시 실행해 주세요.`;
      if (brandExportJobs.size) await window.aroundG.startSellerBrandExportMonitor();
      else stopBrandActivity();
      return;
    }
    brandSelectionBusy = remainingCount > 0;
    renderBrandCards($("#brand-filter")?.value || "");
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = remainingCount
      ? `${failedBrandName} 작업 실패 · ${automation?.message || "판매자센터 자동화에 실패했습니다."} · 다음 ${remainingCount}개 브랜드 작업을 계속합니다.`
      : `${failedBrandName} 작업 실패 · ${automation?.message || "판매자센터 자동화에 실패했습니다."}`;
    if (brandExportJobs.size) {
      touchBrandActivity("등록된 작업 감시와 남은 브랜드 실행을 계속합니다.");
      await window.aroundG.startSellerBrandExportMonitor();
    }
    if (remainingCount > 0) {
      setTimeout(() => exportNextSelectedBrand(generation), 900);
    } else if (!brandExportJobs.size) {
      stopBrandActivity();
    }
    return;
  } else {'''
if old_failure not in renderer:
    raise SystemExit("renderer failure queue block not found")
renderer = renderer.replace(old_failure, new_failure, 1)

old_start_queue = '  const generation = brandWorkHistoryGeneration;\n  // Snapshot the exact brands shown as selected.'
new_start_queue = '  const generation = brandWorkHistoryGeneration;\n  brandExportFailureCount = 0;\n  // Snapshot the exact brands shown as selected.'
if old_start_queue not in renderer:
    raise SystemExit("queue start marker not found")
renderer = renderer.replace(old_start_queue, new_start_queue, 1)

main_path.write_text(main, encoding="utf-8")
renderer_path.write_text(renderer, encoding="utf-8")

# Bump package metadata.
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = "2.10.54"
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lock = json.loads(lock_path.read_text(encoding="utf-8"))
lock["version"] = "2.10.54"
if "" in lock.get("packages", {}):
    lock["packages"][""]["version"] = "2.10.54"
lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Update fixed version assertions in existing regression tests.
for test_path in tests_dir.glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8")
    source = source.replace("2.10.53", "2.10.54")
    source = source.replace(
        'test("one failed brand stops the remaining automatic brand queue", () => {\n  assert.match(renderer, /brandExportQueue = \\[\\]/);\n  assert.match(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);\n  assert.match(renderer, /이미 등록된 작업만 계속 감시 중/);\n});',
        'test("one failed brand does not delete the remaining automatic brand queue", () => {\n  assert.match(renderer, /다음 \\${remainingCount}개 브랜드 작업을 계속합니다/);\n  assert.match(renderer, /setTimeout\\(\\(\\) => exportNextSelectedBrand\\(generation\\), 900\\)/);\n  assert.doesNotMatch(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);\n});'
    )
    test_path.write_text(source, encoding="utf-8")

new_test = tests_dir / "search-input-retry-v2.10.54.test.mjs"
new_test.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("seller search input is retried across frames and localized controls", () => {
  assert.match(main, /searchInputAttempt <= 4/);
  assert.match(main, /sellerWindowFrames\(\)/);
  assert.match(main, /sellerProductFrameRoutingId = candidate\.frame\.routingId/);
  assert.match(main, /상품\|상품명\|브랜드\|품번\|검색\|product\|brand\|article\|spu\|sku\|商品\|品牌\|货号\|搜索\|查询/);
  assert.match(main, /판매자센터 검색 입력창이 아직 표시되지 않아 상품검색 화면을 다시 열고 재시도합니다/);
  assert.match(main, /SELLER_LOGIN_REQUIRED/);
});

test("a failed brand keeps the remaining selected brand queue", () => {
  assert.match(renderer, /다음 \$\{remainingCount\}개 브랜드 작업을 계속합니다/);
  assert.match(renderer, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 900\)/);
  assert.doesNotMatch(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);
});

test("release metadata is 2.10.54", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.54");
  assert.equal(JSON.parse(lockSource).version, "2.10.54");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.54");
});
''', encoding="utf-8")

print("Applied v2.10.54 seller search input retry and queue continuation fix")
