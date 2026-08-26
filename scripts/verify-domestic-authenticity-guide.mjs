import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyDomesticAuthenticity, DOMESTIC_AUTHENTICITY_STATUS } from "../services/domestic-authenticity.mjs";
import { evaluateDomesticProductCard, evaluateDomesticProductCards, trustedAccountSheetRetailer } from "../services/domestic-card-verdict.mjs";

const naverCard = evaluateDomesticProductCard({ store: "네이버 패션타운", articleNumber: "JI0079", text: "아디다스 브랜드직영몰 슈퍼스타 JI0079 149,000원" });
assert.equal(naverCard.trusted, true);
assert.deepEqual(naverCard.labels, ["브랜드직영몰"]);
const naverWrongCode = evaluateDomesticProductCard({ store: "네이버 패션타운", articleNumber: "JI0079", text: "아디다스 백화점 B75806 149,000원" });
assert.equal(naverWrongCode.trusted, false, "trusted label on a different product code must not confirm the requested product");

const naverCards = evaluateDomesticProductCards({ store: "네이버 패션타운", articleNumber: "JI0079", cards: [
  { text: "일반 판매처 JI0079 120,000원" },
  { text: "아디다스 백화점 JI0079 149,000원" },
] });
assert.equal(naverCards.trusted, true);
assert.equal(naverCards.verdict, "confirmed");

const ssgGeneric = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "DD1503-101", text: "나이키 DD1503-101" });
assert.equal(ssgGeneric.officialDistributionVerified, false);

const ssgOfficial = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "DD1503-101", text: "나이키 DD1503-101 본사직영 브랜드 공식관", ssgClassification: "official_brand" });
assert.equal(ssgOfficial.status, DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION);
assert.equal(ssgOfficial.officialDistributionVerified, true);

const ssgDepartment = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "B75806", text: "신세계백화점 아디다스 삼바 OG B75806" });
assert.equal(ssgDepartment.officialDistributionVerified, true);
assert.match(ssgDepartment.label, /신세계|정품 유통 확인/);

const ssgOutlet = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "B75806", text: "신세계 아울렛 아디다스 삼바 OG B75806" });
assert.equal(ssgOutlet.officialDistributionVerified, true);

const ssgWrongCode = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "B75806", text: "신세계백화점 아디다스 JI0079" });
assert.equal(ssgWrongCode.officialDistributionVerified, false, "department label on another product card must not confirm B75806");

const ssgParallel = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "DD1503-101", text: "정품 병행수입 나이키 DD1503-101 신세계백화점" });
assert.equal(ssgParallel.status, DOMESTIC_AUTHENTICITY_STATUS.PARALLEL_IMPORT);
assert.equal(ssgParallel.officialDistributionVerified, false);

const lotteDepartment = classifyDomesticAuthenticity({ store: "롯데온", articleNumber: "B75806", text: "롯데백화점 아디다스 삼바 OG B75806" });
assert.equal(lotteDepartment.officialDistributionVerified, true);

const lotteOutlet = classifyDomesticAuthenticity({ store: "롯데온", articleNumber: "B75806", text: "롯데아울렛 아디다스 삼바 OG B75806" });
assert.equal(lotteOutlet.officialDistributionVerified, true);

const musinsa = classifyDomesticAuthenticity({ store: "무신사", articleNumber: "JI0079", text: "아디다스 슈퍼스타 JI0079" });
assert.equal(musinsa.status, DOMESTIC_AUTHENTICITY_STATUS.ACCOUNT_SHEET_TRUSTED);
assert.equal(musinsa.officialDistributionVerified, true);
assert.match(musinsa.label, /무신사/);

const musinsaWrongCode = classifyDomesticAuthenticity({ store: "무신사", articleNumber: "JI0079", text: "아디다스 슈퍼스타 B75806" });
assert.equal(musinsaWrongCode.officialDistributionVerified, false);

for (const [store, label] of [["29CM", "29CM"], ["ABC마트", "ABC마트"], ["S.I.VILLAGE", "S.I.VILLAGE"]]) {
  assert.equal(trustedAccountSheetRetailer(store)?.label, label);
  const result = classifyDomesticAuthenticity({ store, articleNumber: "SR123UPS11", text: `데상트 SR123UPS11 ${label}` });
  assert.equal(result.officialDistributionVerified, true, `${store} exact-code product must be trusted by account-sheet rule`);
}

// Generic discovery results can also prove a trusted account-sheet retailer from the
// exact product card itself. This is the key Drive-based rule: retailer + exact code.
for (const [cardText, expected] of [
  ["ABC마트 데상트 SR123UPS11 57,950원", "ABC마트"],
  ["신세계백화점 아디다스 B75806 149,000원", "신세계백화점"],
  ["롯데백화점 아디다스 B75806 149,000원", "롯데백화점"],
]) {
  const card = evaluateDomesticProductCard({ store: "병행수입·편집샵", articleNumber: cardText.includes("SR123") ? "SR123UPS11" : "B75806", text: cardText });
  assert.equal(card.trusted, true, `${expected} exact product card should be trusted by Drive account-sheet retailer policy`);
  assert.equal(card.accountSheetRetailer, expected);
  assert.equal(card.accountSheetEvidence, true);
}
const driveWrongCode = evaluateDomesticProductCard({ store: "병행수입·편집샵", articleNumber: "B75806", text: "ABC마트 아디다스 JI0079 149,000원" });
assert.equal(driveWrongCode.trusted, false, "Drive retailer name without exact requested code must not confirm authenticity");
const driveParallel = evaluateDomesticProductCard({ store: "병행수입·편집샵", articleNumber: "B75806", text: "롯데백화점 B75806 병행수입 120,000원" });
assert.equal(driveParallel.trusted, false, "parallel-import wording overrides account-sheet retailer trust");

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
assert.match(relay, /classifyDomesticAuthenticity/, "patched relay must classify distribution evidence");
assert.match(relay, /authenticityLabel: authenticity\.label/, "patched relay must carry the authenticity verdict to UI results");

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
assert.match(renderer, /const trustedDistributionVerified = matchedProducts\.some/, "renderer must detect trusted distribution evidence");
assert.match(renderer, /const accountSheetDirectStore = \["무신사", "29CM", "ABC마트", "S\.I\.VILLAGE"\]\.includes\(sourceStore\)/, "renderer must recognize direct account-sheet retailers");
assert.match(renderer, /trustedDistributionVerified \|\| \(accountSheetDirectStore && matchedProducts\.length > 0\)/, "trusted direct retailer exact matches must finish as confirmed");
assert.match(renderer, /return \{ label: "확인완료", className: "available" \};/, "trusted distribution evidence must finish as 확인완료");

console.log("Drive account-sheet retailer policy verified: exact-code cards from Naver trusted channels, SSG/Shinsegae, Lotte, Musinsa, 29CM, ABC Mart, and S.I.VILLAGE confirm trusted distribution; parallel/import and wrong-code cards do not");
