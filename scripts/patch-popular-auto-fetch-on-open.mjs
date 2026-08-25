import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`popular auto-fetch patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`popular auto-fetch patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));

renderer = replaceOnce(
  renderer,
  `$("#popular-capture").addEventListener("click", async () => {\n  await capturePopularProducts();\n});`,
  `let popularAutoCaptureStarted = false;\nlet popularAutoCaptureRunning = false;\n\nasync function runPopularAutoCaptureOnce() {\n  if (popularAutoCaptureStarted || popularAutoCaptureRunning) return;\n  popularAutoCaptureStarted = true;\n  popularAutoCaptureRunning = true;\n  try {\n    await capturePopularProducts();\n  } finally {\n    popularAutoCaptureRunning = false;\n  }\n}\n\n$("#popular-capture").addEventListener("click", async () => {\n  popularAutoCaptureStarted = true;\n  await capturePopularProducts();\n});\n\ndocument.querySelector('[data-explorer="popular"]')?.addEventListener("click", () => {\n  window.setTimeout(() => { void runPopularAutoCaptureOnce(); }, 0);\n});`,
  "run popular capture automatically when opening popular list",
);

await writeFile(rendererPath, renderer, "utf8");
console.log("popular list now fetches automatically on first open; manual capture remains available for retry");
