import { evaluateDomesticProductCard } from "./domestic-card-verdict.mjs";

export const DOMESTIC_AUTHENTICITY_STATUS = Object.freeze({
  OFFICIAL_DISTRIBUTION: "official_distribution",
  DEPARTMENT_STORE: "department_store",
  ACCOUNT_SHEET_TRUSTED: "account_sheet_trusted",
  PLATFORM_GENUINE_POLICY: "platform_genuine_policy",
  AFFILIATE_RETAILER: "affiliate_retailer",
  MARKETPLACE_UNVERIFIED: "marketplace_unverified",
  PARALLEL_IMPORT: "parallel_import",
});

const PARALLEL_PATTERN = /(?:병행\s*수입|해외\s*(?:직구|구매\s*대행|배송)|구매\s*대행|international\s*shipping|cross[- ]?border)/i;
const OFFICIAL_DISTRIBUTION_PATTERN = /(?:본사\s*직영|브랜드\s*공식관|공식\s*브랜드|공식브랜드|공식\s*수입\s*정품|공식\s*수입|공식수입정품)/i;

function joinedEvidence({ text = "", markup = "", retailerName = "", badges = "" } = {}) {
  return [text, markup, retailerName, badges].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function classifyDomesticAuthenticity({
  store = "",
  articleNumber = "",
  text = "",
  markup = "",
  retailerName = "",
  badges = "",
  ssgClassification = "",
} = {}) {
  const storeName = String(store || "").trim();
  const evidence = joinedEvidence({ text, markup, retailerName, badges });
  const isSsg = /^SSG(?:\s|$)/i.test(storeName) || /ssg/i.test(storeName);
  const isLotte = /^롯데(?:온|ON|백화점|홈쇼핑|\s)/i.test(storeName) || /lotte/i.test(storeName);
  const cardVerdict = evaluateDomesticProductCard({ store: storeName, articleNumber, text: evidence, markup });

  if (cardVerdict.parallelImport || PARALLEL_PATTERN.test(evidence)) {
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.PARALLEL_IMPORT,
      label: "병행수입 · 공식유통 아님",
      evidence: "병행수입/해외유통 표기",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: isSsg ? "SSG 정품 판매 원칙" : "",
    };
  }

  // 계정정보 시트에 등록된 독립 신뢰 판매처(무신사/29CM/ABC마트/S.I.VILLAGE)는
  // 정확 상품코드가 실제 상품 카드에 확인되면 운영 기준상 정품 유통 확인으로 종료한다.
  if (cardVerdict.trusted && cardVerdict.accountSheetRetailer) {
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.ACCOUNT_SHEET_TRUSTED,
      label: `${cardVerdict.accountSheetRetailer} 정품 유통 확인`,
      evidence: `계정정보 시트 등록 신뢰 판매처 · 정확 상품코드 ${String(articleNumber || "").trim()} 확인`,
      officialDistributionVerified: true,
      platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
    };
  }

  // 네이버 패션타운은 플랫폼 전체가 아니라 정확 상품 카드의 브랜드직영몰/백화점/아울렛
  // 라벨이 확인될 때만 신뢰 유통으로 인정한다.
  if (/^네이버(?:\s|$)/i.test(storeName) && cardVerdict.trusted) {
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION,
      label: "네이버 패션타운 정품 유통 확인",
      evidence: `정확 상품 카드 판매처 라벨: ${cardVerdict.labels.join(", ")}`,
      officialDistributionVerified: true,
      platformAuthenticityPolicy: "계정정보 시트 기반 공식 유통처 기준",
    };
  }

  if (isSsg) {
    if (ssgClassification === "official_brand" || OFFICIAL_DISTRIBUTION_PATTERN.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION,
        label: "SSG 공식유통 근거 확인",
        evidence: ssgClassification === "official_brand" ? "브랜드 공식관 · 본사직영" : "본사직영/공식수입 표기",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
      };
    }
    if (cardVerdict.trusted) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE,
        label: "신세계 계열 정품 유통 확인",
        evidence: `상품 카드 판매처 라벨: ${cardVerdict.labels.join(", ")}`,
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
      };
    }
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.PLATFORM_GENUINE_POLICY,
      label: "SSG 정품 유통 미확인",
      evidence: "계정정보 시트의 신세계백화점/아울렛 또는 공식유통 라벨이 확인되지 않음",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
    };
  }

  if (isLotte) {
    if (cardVerdict.trusted) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE,
        label: "롯데 계열 정품 유통 확인",
        evidence: `상품 카드 판매처 라벨: ${cardVerdict.labels.join(", ")}`,
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
      };
    }
    if (OFFICIAL_DISTRIBUTION_PATTERN.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION,
        label: "롯데ON 공식브랜드/공식수입",
        evidence: "공식브랜드·본사직영·공식수입 표기",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
      };
    }
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED,
      label: "롯데ON 정품 유통 미확인",
      evidence: "계정정보 시트의 롯데백화점/아울렛 또는 공식유통 근거 없음",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
    };
  }

  return {
    status: DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED,
    label: "정품 유통 미확인",
    evidence: "계정정보 시트 신뢰 판매처 또는 공식유통 근거 없음",
    officialDistributionVerified: false,
    platformAuthenticityPolicy: "계정정보 시트 신뢰 판매처 기준",
  };
}
