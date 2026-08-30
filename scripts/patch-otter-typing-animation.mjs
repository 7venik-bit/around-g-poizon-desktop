import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const rendererPath = new URL("../src/renderer.js", import.meta.url);
const chunkNames = [
  "part-00-full.txt",
  "part-02.txt",
  "part-03.txt",
  "part-04.txt",
  "part-05.txt",
];

const imageBase64 = (await Promise.all(chunkNames.map((name) =>
  readFile(new URL(`./otter-image-chunks/${name}`, import.meta.url), "utf8")
))).join("").replace(/\s+/g, "");

if (imageBase64.length !== 78_872) {
  throw new Error(`approved otter image length mismatch: ${imageBase64.length}`);
}
const imageBytes = Buffer.from(imageBase64, "base64");
const digest = createHash("sha256").update(imageBytes).digest("hex");
if (digest !== "b181b389bb85a83fa2c48bf5aec6dda45ff0be5ed4a6c9cfaaf55d3c4a830cba") {
  throw new Error(`approved otter image digest mismatch: ${digest}`);
}

let renderer = String(await readFile(rendererPath, "utf8")).replace(/\r\n/g, "\n");

if (renderer.includes('class="domestic-loading-otter otter-approved-image"')) {
  console.log("approved otter image loader already applied");
  process.exit(0);
}

const imageSrc = `data:image/webp;base64,${imageBase64}`;
const replacement = `function renderDomesticLoading(startedAt = Date.now()) {
  const safeStartedAt = Number(startedAt) || Date.now();
  return \`<div class="domestic-search-loading" role="status" aria-live="polite">
    <span class="otter-approved-stage" aria-hidden="true">
      <img class="domestic-loading-otter otter-approved-image" src="${imageSrc}" alt="" draggable="false">
      <span class="otter-key-flash otter-key-flash-left"></span>
      <span class="otter-key-flash otter-key-flash-right"></span>
    </span>
    <span class="domestic-loading-copy"><strong>상품을 찾고 있습니다<span class="domestic-loading-dots">…</span></strong>
      <small>국내 판매처 검색 중 · <b class="domestic-search-elapsed" data-search-started-at="\${safeStartedAt}">0초</b></small>
    </span>
  </div>\`;
}`;

const pattern = /function renderDomesticLoading\(startedAt = Date\.now\(\)\) \{[\s\S]*?\n\}\n\nfunction showDomesticSearchOverlay/;
if (!pattern.test(renderer)) {
  throw new Error("renderDomesticLoading function not found");
}

renderer = renderer.replace(pattern, `${replacement}\n\nfunction showDomesticSearchOverlay`);
await writeFile(rendererPath, renderer, "utf8");
console.log("approved otter image installed unchanged; typing effect remains external");
