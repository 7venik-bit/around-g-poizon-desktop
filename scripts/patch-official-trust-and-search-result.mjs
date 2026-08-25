import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`official-result patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`official-result patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

main = replaceOnce(
  main,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;\n  await wait(2_000);\n  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);`,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  // 일부 공식몰은 실제 검색이 실행되어 결과 화면까지 갔어도 검색 버튼\n  // 클릭/입력 이벤트를 사이트가 가로채 submit 함수가 false를 반환할 수 있다.\n  // 이 경우 화면 결과를 최종 기준으로 다시 확인해 '검색 입력 실패' 오판을 막는다.\n  await wait(submitted ? 2_000 : 1_200);\n  const executed = await officialMallSearchWasExecuted(searchWindow, query, previousUrl);\n  return executed === true;`,
  "accept rendered official-mall result when submit signal is false",
);

await writeFile(mainPath, main, "utf8");

const domesticPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let domestic = normalizeLf(await readFile(domesticPath, "utf8"));

domestic = replaceOnce(
  domestic,
  `            brandVerifiedFromCard: brandMatched,\n            detailArticleVerificationRequired,\n            imageUrl: String(card?.imageUrl || ""),`,
  `            brandVerifiedFromCard: brandMatched,\n            officialBrandDirect: card?.officialBrandStoreLabelMatched === true\n              || /브랜드\\s*직영몰|공식\\s*브랜드|브랜드\\s*스토어/i.test(\`${"${rawCardText} ${String(card?.markup || \"\")}"}\`),\n            detailArticleVerificationRequired,\n            imageUrl: String(card?.imageUrl || ""),`,
  "preserve Naver brand-direct evidence on matched product",
);

await writeFile(domesticPath, domestic, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));

renderer = replaceOnce(
  renderer,
  `    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "상세 확인 필요", className: "pending" };`,
  `    const brandDirectVerified = String(source.store || "") === "네이버 패션타운"\n      && matchedProducts.some((product) => product?.officialBrandDirect === true);\n    if (brandDirectVerified) {\n      return { label: "브랜드직영몰 · 정품 신뢰도 100%", className: "available" };\n    }\n    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "정확 상품 추가 확인", className: "pending" };`,
  "show brand-direct trust before pending state",
);

renderer = replaceOnce(
  renderer,
  `    const detailPending = source.verificationReason\n      ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n      : !matchedProducts.length && Number(source.count || 0) > 0\n        ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 재고·사이즈 상세 수집이 필요합니다.\`\n        : source.absenceConfirmed\n          ? "상품코드→상품명→상품명+상품코드 순서로 검색을 완료했으며 일치 상품이 없습니다."\n          : Number(source.candidateCount || 0) > 0\n            ? "일치 후보 상품을 찾았지만 상세 페이지의 재고·사이즈 확인이 완료되지 않았습니다."\n            : !matchedProducts.length ? "검색은 완료했지만 재고·사이즈 판정 근거가 부족합니다." : "";`,
  `    const brandDirectVerified = String(source.store || "") === "네이버 패션타운"\n      && matchedProducts.some((product) => product?.officialBrandDirect === true);\n    const detailPending = brandDirectVerified\n      ? "브랜드직영몰 확인 · 정품 신뢰도 100% · 상품 확인됨"\n      : source.verificationReason\n        ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n        : !matchedProducts.length && Number(source.count || 0) > 0\n          ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 정확 상품 일치 여부를 추가 확인합니다.\`\n          : source.absenceConfirmed\n            ? "상품코드 중심 검색을 완료했으며 일치 상품이 없습니다."\n            : Number(source.candidateCount || 0) > 0\n              ? "일치 후보 상품을 찾았지만 정확 상품 확인이 완료되지 않았습니다."\n              : !matchedProducts.length ? "검색은 완료했지만 정확 상품 판정 근거가 부족합니다." : "";`,
  "remove obsolete stock-size pending wording and show brand-direct trust detail",
);

renderer = renderer.replaceAll("검색·재고 확인", "검색 결과 열기");

await writeFile(rendererPath, renderer, "utf8");
console.log("official trust wording and official-mall result recognition patched");
