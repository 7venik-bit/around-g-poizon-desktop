import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyDomesticAuthenticity, DOMESTIC_AUTHENTICITY_STATUS } from "../services/domestic-authenticity.mjs";

const ssgGeneric = classifyDomesticAuthenticity({ store: "SSG", text: "나이키 DD1503-101" });
assert.equal(ssgGeneric.status, DOMESTIC_AUTHENTICITY_STATUS.PLATFORM_GENUINE_POLICY);
assert.equal(ssgGeneric.officialDistributionVerified, false);
assert.match(ssgGeneric.label, /SSG 정품 판매 원칙/);

const ssgOfficial = classifyDomesticAuthenticity({
  store: "SSG",
  text: "나이키 DD1503-101 본사직영 브랜드 공식관",
  ssgClassification: "official_brand",
});
assert.equal(ssgOfficial.status, DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION);
assert.equal(ssgOfficial.officialDistributionVerified, true);

const ssgParallel = classifyDomesticAuthenticity({ store: "SSG", text: "정품 병행수입 나이키 DD1503-101" });
assert.equal(ssgParallel.status, DOMESTIC_AUTHENTICITY_STATUS.PARALLEL_IMPORT);
assert.equal(ssgParallel.officialDistributionVerified, false);

const lotteDepartment = classifyDomesticAuthenticity({ store: "롯데온", text: "롯데백화점 나이키 DD1503-101" });
assert.equal(lotteDepartment.status, DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE);
assert.equal(lotteDepartment.officialDistributionVerified, true);
assert.match(lotteDepartment.label, /롯데백화점/);

const lotteOfficial = classifyDomesticAuthenticity({ store: "롯데온", text: "공식브랜드 나이키 DD1503-101 공식수입정품" });
assert.equal(lotteOfficial.status, DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION);
assert.equal(lotteOfficial.officialDistributionVerified, true);

const lotteSellerClaimOnly = classifyDomesticAuthenticity({ store: "롯데온", text: "입점 판매자 100% 정품 나이키 DD1503-101" });
assert.equal(lotteSellerClaimOnly.status, DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED);
assert.equal(lotteSellerClaimOnly.officialDistributionVerified, false, "seller-authored 정품 text alone must not become official distribution evidence");

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
assert.match(relay, /classifyDomesticAuthenticity/, "patched relay must classify SSG/Lotte distribution evidence");
assert.match(relay, /authenticityLabel: authenticity\.label/, "patched relay must carry the guide verdict to UI results");

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
assert.match(renderer, /authenticityLabel/, "renderer must show the guide label");
assert.match(renderer, /유통근거/, "renderer must show the evidence source");

console.log("SSG/Lotte authenticity guide checks passed");
