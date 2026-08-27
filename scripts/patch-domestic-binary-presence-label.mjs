import { readFile, writeFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = String(await readFile(sourcingPath, "utf8")).replace(/\r\n/g, "\n");

const marker = "data-around-g-domestic-binary-presence";
if (sourcing.includes(marker)) {
  console.log("domestic binary presence labels already applied");
  process.exit(0);
}

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`domestic binary presence patch target missing: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
};

sourcing = replaceOnce(
  sourcing,
  '    if (count > 0) return { label: `상품 ${count.toLocaleString("ko-KR")}개`, className: "available" };',
  '    if (count > 0) return { label: "상품 있음", className: "available" };',
  "top-level recognized product label",
);

sourcing = replaceOnce(
  sourcing,
  '    const verifiedCount = (result?.sources || []).reduce((sum, source) =>\n      sum + (source?.countVerified ? Number(source?.count || 0) : 0), 0);\n    if (verifiedCount > 0) return { label: `결과 ${verifiedCount.toLocaleString("ko-KR")}개`, className: "available" };\n    const needsReview = (result?.sources || []).some((source) => source?.verificationPending || source?.verificationFailed);\n    return needsReview\n      ? { label: "확인 필요", className: "pending" }\n      : { label: "상품 없음", className: "missing" };',
  '    const sources = Array.isArray(result?.sources) ? result.sources : [];\n    const sourceHasProduct = sources.some((source) => Number(source?.count || 0) > 0\n      || source?.presenceConfirmed === true\n      || source?.exactProductPresenceConfirmed === true\n      || Boolean(source?.verifiedProductUrl));\n    return sourceHasProduct\n      ? { label: "상품 있음", className: "available" }\n      : { label: "상품 없음", className: "missing" };',
  "remove review-needed status",
);

sourcing = replaceOnce(
  sourcing,
  '              <div class="sourcing-product-store"><span>${text(retailer)}</span>${official ? `<span class="official">공식</span>` : ""}</div>',
  '              <div class="sourcing-product-store"><span>${text(retailer)}</span>${official ? `<span class="official">공식</span>` : ""}<span class="sourcing-product-present">상품 있음</span></div>',
  "product-row presence badge",
);

sourcing = replaceOnce(
  sourcing,
  '          .filter((source) => Number(source?.count || 0) > 0 || source?.verificationPending || source?.verificationFailed)\n          .map((source) => {\n            const count = Number(source?.count || 0);\n            const message = count > 0\n              ? `검색 결과 ${count.toLocaleString("ko-KR")}개 확인 · 상품 상세는 판매처에서 직접 확인`\n              : source?.verificationFailed ? "검색 결과 확인이 완료되지 않았습니다." : "판매처에서 직접 확인이 필요합니다.";\n            return `<div class="sourcing-source-fallback"><strong>${text(source?.store || "판매처")}</strong><span>${text(message)}</span>${sourceAction(source)}</div>`;\n          }).join("");',
  '          .map((source) => {\n            const present = Number(source?.count || 0) > 0\n              || source?.presenceConfirmed === true\n              || source?.exactProductPresenceConfirmed === true\n              || Boolean(source?.verifiedProductUrl);\n            const message = source?.verificationFailed ? "검색 실패" : present ? "상품 있음" : "상품 없음";\n            return `<div class="sourcing-source-fallback"><strong>${text(source?.store || "판매처")}</strong><span>${text(message)}</span>${sourceAction(source, {}, present ? "상품 링크" : "판매처 열기")}</div>`;\n          }).join("");',
  "binary per-source fallback status",
);

sourcing += `\n\n(() => {\n  document.documentElement.setAttribute("${marker}", "true");\n  const style = document.createElement("style");\n  style.setAttribute("data-around-g-domestic-binary-presence-style", "true");\n  style.textContent = \`\n    .sourcing-product-present{display:inline-flex!important;align-items:center!important;padding:2px 6px!important;border-radius:999px!important;background:#ecfdf3!important;color:#147a4a!important;font-size:9px!important;font-weight:800!important;white-space:nowrap!important}\n  \`;\n  document.head.appendChild(style);\n})();\n`;

await writeFile(sourcingPath, sourcing, "utf8");
console.log("domestic source status simplified to 상품 있음 / 상품 없음; review-needed copy removed");
