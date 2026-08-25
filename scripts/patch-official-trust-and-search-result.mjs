import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`official-result patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`official-result patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(main,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  if (!submitted) return false;\n  await wait(2_000);\n  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);`,
  `  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);\n  const submitted = await submitOfficialMallSearch(searchWindow, query);\n  // 일부 공식몰은 실제 검색 결과 화면까지 이동해도 사이트 이벤트 처리 방식 때문에\n  // submit 함수가 false를 반환할 수 있다. 최종 화면을 다시 확인해 성공 여부를 판정한다.\n  await wait(submitted ? 2_000 : 1_200);\n  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);`,
  "accept rendered official-mall result when submit signal is false");
main = replaceOnce(main,
  `        candidateCount: Number(result?.candidateCount || 0),\n      // The official search URL and a verified product-detail URL are`,
  `        candidateCount: Number(result?.candidateCount || 0),\n        naverChannelCounts: result?.naverChannelCounts || null,\n        naverTrustedChannelEvidence: result?.naverTrustedChannelEvidence === true,\n        naverAllSearchVerdict: result?.naverAllSearchVerdict || null,\n      // The official search URL and a verified product-detail URL are`,
  "preserve Naver trusted evidence in source result");
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(renderer,
  `    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "상세 확인 필요", className: "pending" };`,
  `    const naverFashionTownConfirmed = String(source.store || "") === "네이버 패션타운"\n      && (source.presenceConfirmed === true || source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length > 0);\n    if (naverFashionTownConfirmed) return { label: "확인완료", className: "available" };\n    const officialMallSource = String(source.store || "") === "브랜드 공식몰";\n    if (officialMallSource) {\n      const officialResultFound = source.presenceConfirmed === true\n        || matchedProducts.length > 0\n        || (source.searchCompleted === true && Number(source.count || 0) > 0);\n      const officialResultMissing = source.absenceConfirmed === true\n        || (source.searchCompleted === true && Number(source.count || 0) === 0 && Number(source.candidateCount || 0) === 0);\n      if (officialResultFound) return { label: "확인완료", className: "available" };\n      if (officialResultMissing) return { label: "상품없음", className: "missing" };\n    }\n    if (source.verificationFailed) {\n      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };\n    }\n    if (source.verificationPending) return { label: "정확 상품 추가 확인", className: "pending" };`,
  "show Naver trusted evidence and official mall binary verdict before pending state");
renderer = replaceOnce(renderer,
  `    const detailPending = source.verificationReason\n      ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n      : !matchedProducts.length && Number(source.count || 0) > 0\n        ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 재고·사이즈 상세 수집이 필요합니다.\`\n        : source.absenceConfirmed\n          ? "상품코드→상품명→상품명+상품코드 순서로 검색을 완료했으며 일치 상품이 없습니다."\n          : Number(source.candidateCount || 0) > 0\n            ? "일치 후보 상품을 찾았지만 상세 페이지의 재고·사이즈 확인이 완료되지 않았습니다."\n            : !matchedProducts.length ? "검색은 완료했지만 재고·사이즈 판정 근거가 부족합니다." : "";`,
  `    const naverFashionTownConfirmed = String(source.store || "") === "네이버 패션타운"\n      && (source.presenceConfirmed === true || source.naverTrustedChannelEvidence === true || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length > 0);\n    const officialMallSource = String(source.store || "") === "브랜드 공식몰";\n    const officialResultFound = officialMallSource && (source.presenceConfirmed === true || matchedProducts.length > 0 || (source.searchCompleted === true && Number(source.count || 0) > 0));\n    const officialResultMissing = officialMallSource && (source.absenceConfirmed === true || (source.searchCompleted === true && Number(source.count || 0) === 0 && Number(source.candidateCount || 0) === 0));\n    const detailPending = naverFashionTownConfirmed\n      ? "네이버 패션타운에서 상품코드 검색 결과와 공식 유통 채널이 확인되어 정품 유통 근거가 충분합니다."\n      : officialResultFound\n        ? "브랜드 공식몰 검색 결과에서 상품을 확인했습니다."\n        : officialResultMissing\n          ? "브랜드 공식몰 검색 결과에 상품이 없습니다."\n          : source.verificationReason\n            ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."\n            : !matchedProducts.length && Number(source.count || 0) > 0\n              ? \`검색 결과 \${Number(source.count)}개를 확인했습니다. 정확 상품 일치 여부를 추가 확인합니다.\`\n              : source.absenceConfirmed\n                ? "상품코드 중심 검색을 완료했으며 일치 상품이 없습니다."\n                : Number(source.candidateCount || 0) > 0\n                  ? "일치 후보 상품을 찾았지만 정확 상품 확인이 완료되지 않았습니다."\n                  : !matchedProducts.length ? "검색은 완료했지만 정확 상품 판정 근거가 부족합니다." : "";`,
  "show Naver authenticity evidence and official mall binary detail");
renderer = renderer.replaceAll("검색·재고 확인", "검색 결과 열기");
renderer = renderer.replaceAll("검색 입력 실패", "검색 결과 확인");
renderer = renderer.replaceAll("상품코드를 검색창에 입력하고 검색 버튼을 누르는 단계에서 중단됐습니다.", "검색 결과 화면을 확인하고 있습니다.");
await writeFile(rendererPath, renderer, "utf8");
console.log("Naver Fashion Town authenticity evidence wording and official mall binary verdict applied");
