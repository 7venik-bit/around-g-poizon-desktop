import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyDomesticAuthenticity, DOMESTIC_AUTHENTICITY_STATUS } from "../services/domestic-authenticity.mjs";
import { evaluateDomesticProductCard, evaluateDomesticProductCards } from "../services/domestic-card-verdict.mjs";

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
assert.equal(ssgGeneric.status, DOMESTIC_AUTHENTICITY_STATUS.PLATFORM_GENUINE_POLICY);
assert.equal(ssgGeneric.officialDistributionVerified, false);
assert.match(ssgGeneric.label, /SSG 정품 판매 원칙/);

const ssgOfficial = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "DD1503-101", text: "나이키 DD1503-101 본사직영 브랜드 공식관", ssgClassification: "official_brand" });
assert.equal(ssgOfficial.status, DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION);
assert.equal(ssgOfficial.officialDistributionVerified, true);

const ssgDepartment = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "B75806", text: "신세계백화점 아디다스 삼바 OG B75806" });
assert.equal(ssgDepartment.status, DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE);
assert.equal(ssgDepartment.officialDistributionVerified, true);
assert.match(ssgDepartment.label, /신세계백화점/);
assert.match(ssgDepartment.evidence, /상품 카드 판매처 라벨/);

const ssgWrongCode = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "B75806", text: "신세계백화점 아디다스 JI0079" });
assert.equal(ssgWrongCode.officialDistributionVerified, false, "department label on another product card must not confirm B75806");

const ssgParallel = classifyDomesticAuthenticity({ store: "SSG", articleNumber: "DD1503-101", text: "정품 병행수입 나이키 DD1503-101 신세계백화점" });
assert.equal(ssgParallel.status, DOMESTIC_AUTHENTICITY_STATUS.PARALLEL_IMPORT);
assert.equal(ssgParallel.officialDistributionVerified, false);

const lotteDepartment = classifyDomesticAuthenticity({ store: "롯데온", articleNumber: "B75806", text: "롯데백화점 아디다스 삼바 OG B75806" });
assert.equal(lotteDepartment.status, DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE);
assert.equal(lotteDepartment.officialDistributionVerified, true);
assert.match(lotteDepartment.label, /롯데백화점/);
assert.match(lotteDepartment.evidence, /상품 카드 판매처 라벨/);

const lotteOfficial = classifyDomesticAuthenticity({ store: "롯데온", articleNumber: "DD1503-101", text: "공식브랜드 나이키 DD1503-101 공식수입정품" });
assert.equal(lotteOfficial.status, DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION);
assert.equal(lotteOfficial.officialDistributionVerified, true);

const lotteSellerClaimOnly = classifyDomesticAuthenticity({ store: "롯데온", articleNumber: "DD1503-101", text: "입점 판매자 100% 정품 나이키 DD1503-101" });
assert.equal(lotteSellerClaimOnly.status, DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED);
assert.equal(lotteSellerClaimOnly.officialDistributionVerified, false);

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
assert.match(relay, /classifyDomesticAuthenticity/, "patched relay must classify SSG/Lotte distribution evidence");
assert.match(relay, /articleNumber,\n          text: rawCardText/, "relay must pass exact product code into the shared card verdict engine");
assert.match(relay, /authenticityLabel: authenticity\.label/, "patched relay must carry the guide verdict to UI results");

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
assert.match(renderer, /const departmentStoreVerified = matchedProducts\.some/, "renderer must detect department-store evidence on matched product cards");
assert.match(renderer, /if \(departmentStoreVerified\) return \{ label: "확인완료", className: "available" \};/, "department-store label evidence must finish as 확인완료");

console.log("Unified exact product-card verdict checks passed for Naver, SSG, and LotteON");
