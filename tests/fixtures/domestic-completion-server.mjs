// Local, offline renderer reproduction. No retailer or Electron IPC is called.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.DOMESTIC_FIXTURE_ROOT || fileURLToPath(new URL("../../", import.meta.url)));
const renderer = readFileSync(resolve(root, "src/renderer.js"), "utf8");
function section(start, end) {
  const from = renderer.indexOf(start);
  const to = renderer.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing fixture boundary: ${start}`);
  return renderer.slice(from, to);
}
const extracted = [
  section("function renderVerifiedSpuRows(", "function mergeDomesticSearchProducts("),
  section("function stockWatchRegistrationButton(", "function renderStockWatches("),
  section("function rawExcelDomesticResultLinks(", "function updateExcelPreviewSelectionUi("),
  section("function updateExcelPreviewSelectionUi(", "function excelProductMetric("),
  section("function normalizedProductIdentity(", "function domesticSearchInput("),
  section("function domesticSearchInput(", "function renderExcelProductRows("),
  section("function renderExcelProductRows(", "function restoreSavedExcelSearchResults("),
  section("function persistExcelSearchResults(", "async function showExcelPreview("),
  section('$("#excel-preview-search-selected")?.addEventListener("click", async () => {', '$("#excel-preview-prev")?.addEventListener('),
].join("\n");
const setup = `
const $ = (s) => document.querySelector(s);
const text = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const money = (v) => Number(v || 0).toLocaleString('ko-KR') + '원';
const brandImportPathKey = (v) => v;
const elapsedKoreanDuration = (v) => Math.floor(v / 1000) + '초';
const selectedDomesticSourceGroups = () => ['musinsa'];
const verifiedExcelProductPoizonPrice = (p) => p.averagePrice || 0;
const excelProductMetric = (raw, v) => raw || String(v || 0);
function domesticStatus() { return {className:'available',label:'상품 있음'}; }
const currentExcelPreviewFilters = () => ({});
function renderDomestic() { return 'fixture fallback'; }
let installedAppVersion = '2.10.703-fixture';
const DOMESTIC_SEARCH_MAX_WAIT_MS = 1500;
let excelPreviewBatchSearching = false, selectedBrandDomesticQueueRunning = false;
let excelPreviewSelectingAll = false, excelPreviewIntegrated = true;
let activeExcelPreview = {file:{path:'fixture.xlsx'}, viewMode:'products', totalRows:1};
const product = {articleNumber:'SR123UPS11-服',title:'데상트 테스트 상품',brandName:'데상트',spuId:'fixture',verificationOptions:[],optionCount:1,_excelSelectionKey:'fixture.xlsx::fixture'};
let excelPreviewPageProducts = [product];
let excelPreviewPageKeys = [product._excelSelectionKey];
const selectedExcelPreviewProducts = new Set(excelPreviewPageKeys);
const excelPreviewProductCache = new Map([[product._excelSelectionKey, product]]);
const excelPreviewSearchResults = new Map(), excelPreviewSearchResultsByPath = new Map();
const domesticIdentitySearchCache = new Map();
const EXCEL_SEARCH_RESULTS_KEY = 'offline-fixture';
let progressCallback;
window.aroundG = {
  onDomesticSearchProgress: (fn) => { progressCallback = fn; },
  searchDomestic: async () => {
    await new Promise(r => setTimeout(r, 100));
    progressCallback({completed:8,total:8,source:'이미지 교차검증'});
    await new Promise(r => setTimeout(r, 100));
    return {ok:true,data:{products:[{store:'무신사',name:'데상트 테스트 상품',articleNumber:'SR123UPS11',price:59000,url:'https://example.com/item',stockStatus:'in_stock'}],sources:[{store:'무신사',count:1,countVerified:true}]}};
  },
  cancelDomesticSearch: async () => ({ok:true}),
  getExcelColumnLayout: async () => ({ok:true,columnLayout:[]}),
  updateExcelColumnLayout: async () => ({ok:true,columnLayout:[]}),
};
function clearDomesticIdentityCache() { domesticIdentitySearchCache.clear(); }
async function showExcelPreview() { throw new Error('Unexpected Excel IPC in product view'); }
window.addEventListener('error', (e) => { $('#fixture-errors').textContent += e.message + '\\n'; });
window.addEventListener('unhandledrejection', (e) => { $('#fixture-errors').textContent += String(e.reason) + '\\n'; });
`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>검색 완료 오프라인 검증</title>
<link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/domestic-loading-overlay.css">
<style>body{display:block;padding:30px;background:white}#fixture-errors{color:red}table{width:100%}</style>
<h1>검색 완료 오프라인 검증</h1><p>실제 renderer + 설치 시 화면 확장 코드 / 외부 검색은 테스트 응답</p>
<div id="excel-preview"><div id="excel-preview-filters"><p id="excel-filter-status">준비됨</p></div>
<button id="excel-preview-search-selected">상품검색</button><span id="excel-preview-selected-count"></span>
<table><thead id="excel-preview-columns"></thead><tbody id="excel-preview-rows"></tbody></table></div>
<pre id="fixture-errors"></pre><script src="/fixture.js"></script>
<script src="/src/excel-column-layout.js"></script><script src="/src/domestic-result-verdict.js"></script>
<script src="/src/sourcing-view.js"></script><script src="/src/domestic-inline-results.js"></script>
<script>renderExcelProductRows(activeExcelPreview.file,excelPreviewPageProducts);updateExcelPreviewSelectionUi(excelPreviewPageKeys);</script></html>`;
const types = {".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".gif":"image/gif", ".webp":"image/webp"};
export const fixtureHtml = html;
export const fixtureScript = setup + extracted;
export const fixtureRoot = root;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) createServer((req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const body = path === "/" ? html : path === "/fixture.js" ? setup + extracted
      : /^\/(src|assets)\/[\w./-]+$/.test(path) && !path.includes("..")
        ? readFileSync(resolve(root, path.slice(1))) : null;
    if (body === null) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", path === "/" ? "text/html; charset=utf-8" : types[extname(path)] || "application/octet-stream");
    res.end(body);
  } catch (error) { res.writeHead(500).end(String(error)); }
}).listen(8765, "127.0.0.1", () => console.log("Offline fixture: http://localhost:8765"));
