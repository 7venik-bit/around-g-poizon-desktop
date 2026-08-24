export const DOMESTIC_AUTHENTICITY_STATUS = Object.freeze({
  OFFICIAL_DISTRIBUTION: "official_distribution",
  DEPARTMENT_STORE: "department_store",
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

  if ((isSsg || isLotte) && PARALLEL_PATTERN.test(evidence)) {
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.PARALLEL_IMPORT,
      label: "병행수입 · 공식유통 아님",
      evidence: "병행수입/해외유통 표기",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: isSsg ? "SSG 정품 판매 원칙" : "",
    };
  }

  if (isSsg) {
    if (ssgClassification === "official_brand" || OFFICIAL_DISTRIBUTION_PATTERN.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION,
        label: "SSG 공식유통 근거 확인",
        evidence: ssgClassification === "official_brand" ? "브랜드 공식관 · 본사직영" : "본사직영/공식수입 표기",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "SSG 정품 판매 원칙",
      };
    }
    if (/신세계\s*백화점|SSG\s*백화점|백화점/i.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE,
        label: "신세계백화점 판매",
        evidence: "신세계백화점 판매처 라벨",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "SSG 정품 판매 원칙",
      };
    }
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.PLATFORM_GENUINE_POLICY,
      label: "SSG 정품 판매 원칙",
      evidence: "SSG.COM 플랫폼 정품 판매 정책 · 공식유통 여부는 별도 확인",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: "SSG 정품 판매 원칙",
    };
  }

  if (isLotte) {
    if (/롯데\s*백화점|롯데백화점/i.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.DEPARTMENT_STORE,
        label: "롯데백화점 판매",
        evidence: "롯데백화점 판매처 라벨",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "",
      };
    }
    if (OFFICIAL_DISTRIBUTION_PATTERN.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.OFFICIAL_DISTRIBUTION,
        label: "롯데ON 공식브랜드/공식수입",
        evidence: "공식브랜드·본사직영·공식수입 표기",
        officialDistributionVerified: true,
        platformAuthenticityPolicy: "",
      };
    }
    if (/롯데\s*홈쇼핑|롯데홈쇼핑/i.test(evidence)) {
      return {
        status: DOMESTIC_AUTHENTICITY_STATUS.AFFILIATE_RETAILER,
        label: "롯데홈쇼핑 판매처",
        evidence: "롯데홈쇼핑 판매처 라벨 · 브랜드 공식유통 여부 별도",
        officialDistributionVerified: false,
        platformAuthenticityPolicy: "",
      };
    }
    return {
      status: DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED,
      label: "롯데ON 입점판매자 · 공식유통 미확인",
      evidence: "롯데백화점/공식브랜드/공식수입 근거 없음",
      officialDistributionVerified: false,
      platformAuthenticityPolicy: "",
    };
  }

  return {
    status: DOMESTIC_AUTHENTICITY_STATUS.MARKETPLACE_UNVERIFIED,
    label: "공식유통 미확인",
    evidence: "판정 대상 판매처 근거 없음",
    officialDistributionVerified: false,
    platformAuthenticityPolicy: "",
  };
}
