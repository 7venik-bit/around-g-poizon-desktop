import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../src/audit-trace.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

function createTrace() {
  const dom = new JSDOM(`
    <button id="official-domain-audit-toggle" data-running="true"></button>
    <section id="audit-trace-panel" tabindex="-1" hidden>
      <strong id="audit-trace-title"></strong>
      <p id="audit-trace-summary"></p>
      <span id="audit-trace-state"></span>
      <button id="audit-trace-stop" hidden></button>
      <button id="audit-trace-close"></button>
      <i id="audit-trace-progress-fill"></i>
      <strong id="audit-trace-current"></strong>
      <div id="audit-trace-output"></div>
    </section>`, { runScripts: "outside-only" });
  const { window } = dom;
  const output = window.document.getElementById("audit-trace-output");
  const scrolls = [];
  output.scrollTo = (options) => scrolls.push(options);
  window.requestAnimationFrame = (callback) => callback();
  window.eval(source);
  const trace = window.AroundGAuditTrace.createAuditTraceController(window.document,
    () => new Date("2026-09-23T01:00:00Z"));
  return { trace, dom, output, scrolls };
}

test("official-mall trace follows real brand phases, distinct candidates and stop state", () => {
  const { trace, dom, output, scrolls } = createTrace();
  trace.open("official");
  const base = { running: true, state: "running", startedAt: "run-1", currentBrand: "Nike",
    processed: 0, runTotal: 3400, attempt: 1 };
  trace.official({ ...base, phase: "naver_search", detail: "https://search.naver.com/brand" });
  trace.official({ ...base, phase: "official_site", detail: "https://www.nike.com/kr" });
  trace.official({ ...base, phase: "official_site", detail: "https://nike.example/alternate" });
  trace.official({ ...base, phase: "official_site", detail: "https://nike.example/alternate" });
  trace.official({ ...base, phase: "saved", processed: 1,
    updatedBrand: { status: "verified" } });
  trace.official({ running: false, state: "paused", startedAt: "run-1", processed: 1, runTotal: 3400 });
  const lines = [...output.children].map((line) => line.textContent);
  assert.equal(lines.length, 6, "the duplicate progress event must not create a fake step");
  assert.match(lines.join("\n"), /nike\.example\/alternate/);
  assert.match(lines.join("\n"), /saveResult\("Nike", "verified"\)/);
  assert.match(lines.at(-1), /state: "paused"/);
  assert.equal(scrolls.length, lines.length);
  assert.ok(scrolls.every((item) => item.behavior === "smooth"));
  assert.match(dom.window.document.getElementById("audit-trace-summary").textContent, /일시 중지/);
});

test("site-health trace shows each actual request, HTTP result and saved report", () => {
  const { trace, output, dom } = createTrace();
  trace.open("server");
  const base = { running: true, state: "running", startedAt: "run-2", total: 2 };
  trace.server({ ...base, completed: 0, currentTarget: { id: "a", name: "Store A", url: "https://a.example/" } });
  trace.server({ ...base, completed: 1, lastResult: { id: "a", name: "Store A", statusCode: 200,
    responseMs: 32, result: "정상", ok: true } });
  trace.server({ ...base, completed: 1, currentTarget: { id: "b", name: "Store B", url: "https://b.example/" } });
  trace.server({ ...base, completed: 2, lastResult: { id: "b", name: "Store B", statusCode: 403,
    responseMs: 40, result: "접속 가능·로그인 필요", ok: true } });
  trace.server({ running: false, state: "completed", startedAt: "run-2", total: 2,
    passed: 2, failed: 0, reportPath: "C:/reports/health.xlsx" });
  const lines = [...output.children].map((line) => line.textContent).join("\n");
  assert.match(lines, /await fetch\("https:\/\/a\.example\/"\)/);
  assert.match(lines, /HTTP 200 · 32ms/);
  assert.match(lines, /HTTP 403 · 40ms · 접속 가능·로그인 필요/);
  assert.match(lines, /report\.saved\("C:\/reports\/health\.xlsx"\)/);
  assert.match(dom.window.document.getElementById("audit-trace-summary").textContent, /2개 응답/);
  assert.equal(dom.window.document.getElementById("audit-trace-progress-fill").style.width, "100%");
});

test("official trace prints one final line when stop response repeats the worker result", () => {
  const { trace, output } = createTrace();
  trace.open("official");
  const final = { running: false, state: "paused", startedAt: "run-4", processed: 2, runTotal: 3400 };
  trace.official(final);
  trace.official({ ...final, phase: "paused", updatedAt: "later" });
  const finishes = [...output.children].filter((line) => line.textContent.includes("auditOfficialStores.finish"));
  assert.equal(finishes.length, 1);
  assert.match(finishes[0].textContent, /processed: 2/);
});

test("expanded trace follows real progress and offers an in-screen pause", () => {
  const { trace, dom, output } = createTrace();
  const doc = dom.window.document;
  let pauses = 0;
  doc.getElementById("official-domain-audit-toggle").addEventListener("click", () => { pauses += 1; });
  trace.open("official");
  trace.official({ running: true, state: "running", startedAt: "run-5",
    currentBrand: "Nike", phase: "official_site", processed: 1, runTotal: 4,
    detail: "https://www.nike.com/" });
  assert.equal(doc.getElementById("audit-trace-progress-fill").style.width, "25%");
  assert.match(doc.getElementById("audit-trace-current").textContent, /nike\.com/);
  assert.equal(doc.getElementById("audit-trace-state").textContent, "실행 중");
  assert.equal(doc.getElementById("audit-trace-stop").hidden, false);
  doc.getElementById("audit-trace-stop").click();
  assert.equal(pauses, 1);
  assert.equal(doc.getElementById("audit-trace-stop").disabled, true);
  assert.equal(output.children.length, 2, "the control must not add fabricated audit events");
  trace.official({ running: false, state: "paused", startedAt: "run-5", processed: 1, runTotal: 4 });
  assert.equal(doc.getElementById("audit-trace-stop").hidden, true);
  assert.equal(doc.getElementById("audit-trace-state").textContent, "일시 중지");
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(doc.getElementById("audit-trace-panel").hidden, true);
});

test("dismissed official trace reopens with prior rows and the latest live state", () => {
  const { trace, output, dom } = createTrace();
  const panel = dom.window.document.getElementById("audit-trace-panel");
  trace.open("official");
  trace.official({ running: true, state: "running", startedAt: "run-6",
    currentBrand: "Nike", phase: "saved", processed: 1, runTotal: 4,
    updatedBrand: { status: "verified" } });
  const earlier = output.children.length;
  trace.close();
  trace.official({ running: true, state: "running", startedAt: "run-6",
    currentBrand: "Adidas", phase: "official_site", processed: 1, runTotal: 4,
    detail: "https://www.adidas.co.kr/" });
  assert.equal(output.children.length, earlier, "closing the screen should only hide live rows");
  trace.show("official");
  assert.equal(panel.hidden, false);
  assert.match(output.textContent, /saveResult\("Nike", "verified"\)/);
  assert.match(output.textContent, /adidas\.co\.kr/);
  assert.match(dom.window.document.getElementById("audit-trace-summary").textContent, /Adidas/);
});

test("a running server check can attach its display after it has started", () => {
  const { trace, dom, output } = createTrace();
  trace.server({ running: true, state: "running", startedAt: "run-7", total: 9,
    completed: 4, currentTarget: { id: "store", name: "Store", url: "https://store.example/" } });
  trace.show("server");
  assert.equal(dom.window.document.getElementById("audit-trace-panel").hidden, false);
  assert.match(dom.window.document.getElementById("audit-trace-summary").textContent, /4\/9/);
  assert.match(output.textContent, /store\.example/);
});

test("trace stops writing after dismissal, caps old lines and uses only actual checks", () => {
  const { trace, output, dom } = createTrace();
  trace.open("official");
  for (let index = 0; index < 260; index += 1) {
    trace.official({ running: true, state: "running", startedAt: "run-3",
      currentBrand: `Brand ${index}`, phase: "starting", processed: index, runTotal: 3400 });
  }
  assert.equal(output.childElementCount, 240);
  dom.window.document.getElementById("audit-trace-close").click();
  trace.official({ running: true, state: "running", startedAt: "run-3",
    currentBrand: "Hidden", phase: "starting", processed: 261, runTotal: 3400 });
  assert.equal(output.childElementCount, 240);
  assert.equal(dom.window.document.getElementById("audit-trace-panel").hidden, true);
  assert.match(mainSource, /const result = await inspectSiteHealthTarget\(target\);\s*results\.push\(result\);\s*sendWeeklySiteHealthStatus\(/);
  assert.match(mainSource, /const progress = \(phase, detail = ""\) => sendOfficialDomainAuditProgress/);
});
