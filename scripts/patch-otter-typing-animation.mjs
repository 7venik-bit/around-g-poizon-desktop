import { readFile, writeFile } from "node:fs/promises";

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = String(await readFile(rendererPath, "utf8")).replace(/\r\n/g, "\n");

if (renderer.includes('class="domestic-loading-otter otter-employee-svg"')) {
  console.log("otter typing animation already applied");
  process.exit(0);
}

const replacement = `function renderDomesticLoading(startedAt = Date.now()) {
  const safeStartedAt = Number(startedAt) || Date.now();
  return \`<div class="domestic-search-loading" role="status" aria-live="polite">
    <svg class="domestic-loading-otter otter-employee-svg" viewBox="0 0 300 190" aria-hidden="true" focusable="false">
      <g class="otter-tail-group">
        <path class="otter-tail-shape" d="M97 130C60 135 30 151 37 164c8 15 48 9 85-14 15-9 27-18 36-29" fill="#a97648" stroke="#6f563f" stroke-width="5" stroke-linecap="round"/>
      </g>
      <g class="otter-body-group">
        <ellipse cx="137" cy="121" rx="59" ry="50" fill="#b98250" stroke="#6f563f" stroke-width="5"/>
        <ellipse cx="139" cy="128" rx="34" ry="35" fill="#ead8b8"/>
      </g>
      <g class="otter-head-group">
        <circle cx="96" cy="56" r="17" fill="#b98250" stroke="#6f563f" stroke-width="5"/>
        <circle cx="176" cy="56" r="17" fill="#b98250" stroke="#6f563f" stroke-width="5"/>
        <circle cx="96" cy="56" r="8" fill="#d6aa77"/>
        <circle cx="176" cy="56" r="8" fill="#d6aa77"/>
        <ellipse cx="136" cy="77" rx="55" ry="46" fill="#b98250" stroke="#6f563f" stroke-width="5"/>
        <ellipse cx="136" cy="90" rx="35" ry="25" fill="#f0dfc3"/>
        <circle cx="116" cy="73" r="5" fill="#2f2924"/>
        <circle cx="157" cy="73" r="5" fill="#2f2924"/>
        <ellipse cx="136" cy="86" rx="8" ry="6" fill="#3f3027"/>
        <path d="M136 92c-4 7-10 9-17 7M136 92c4 7 10 9 17 7" fill="none" stroke="#6f563f" stroke-width="3" stroke-linecap="round"/>
        <g class="otter-whiskers" fill="none" stroke="#6f563f" stroke-width="3" stroke-linecap="round">
          <path d="M108 88 78 81M108 95 75 96M164 88l30-7M164 95l33 1"/>
        </g>
      </g>
      <g class="otter-arm-left" fill="none" stroke="#6f563f" stroke-width="13" stroke-linecap="round">
        <path d="M107 123c18 5 30 12 40 21"/>
      </g>
      <g class="otter-arm-right" fill="none" stroke="#6f563f" stroke-width="13" stroke-linecap="round">
        <path d="M163 122c7 5 14 12 20 20"/>
      </g>
      <g class="otter-laptop-group">
        <path d="M154 100 251 108 241 153 148 145Z" fill="#e8f0f8" stroke="#17365d" stroke-width="5" stroke-linejoin="round"/>
        <text x="198" y="132" text-anchor="middle" font-size="24" font-family="Segoe UI,Arial,sans-serif" font-weight="800" fill="#8da2b8">G</text>
        <path d="M143 145 243 154 226 169 132 158Z" fill="#cbd9e8" stroke="#17365d" stroke-width="5" stroke-linejoin="round"/>
        <g stroke="#7890a8" stroke-width="2">
          <path d="m151 149 74 7M147 153l72 7M144 157l66 6"/>
          <path d="m159 148-3 12M171 149l-3 12M183 150l-3 12M195 151l-3 12M207 152l-3 12"/>
        </g>
      </g>
      <g class="otter-paw-left-group">
        <ellipse cx="153" cy="148" rx="15" ry="10" fill="#d9b985" stroke="#6f563f" stroke-width="4"/>
      </g>
      <g class="otter-paw-right-group">
        <ellipse cx="180" cy="151" rx="15" ry="10" fill="#d9b985" stroke="#6f563f" stroke-width="4"/>
      </g>
      <g class="otter-typing-tick otter-typing-tick-left" fill="none" stroke="#2f80ed" stroke-width="4" stroke-linecap="round">
        <path d="m137 137-8-6M134 145l-10-1"/>
      </g>
      <g class="otter-typing-tick otter-typing-tick-right" fill="none" stroke="#2f80ed" stroke-width="4" stroke-linecap="round">
        <path d="m197 141 9-5M198 149l10 1"/>
      </g>
    </svg>
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
console.log("legacy loader mascot replaced with otter typing SVG");
