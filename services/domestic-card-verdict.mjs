const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

// Google Drive `어라운드지_포이즌시트`의 `계정정보` 탭에서 실제 소싱용으로
// 관리 중인 판매처 이름을 비민감 정보만 코드에 반영한다. 로그인 ID/비밀번호는
// 절대 코드나 로그에 저장하지 않는다.
const ACCOUNT_SHEET_TRUSTED_RETAILERS = Object.freeze({
  musinsa: { label: "무신사", aliases: ["무신사", "MUSINSA"] },
  twentyNineCm: { label: "29CM", aliases: ["29CM", "29cm"] },
  abcMart: { label: "ABC마트", aliases: ["ABC마트", "ABC MART", "ABC-MART"] },
  siVillage: { label: "S.I.VILLAGE", aliases: ["S.I.VILLAGE", "SIVILLAGE", "에스아이빌리지", "신세계 빌리지"] },
  shinsegaeDepartment: { label: "신세계백화점", aliases: ["신세계백화점", "신세계 백화점", "SHINSEGAE"] },
  shinsegaeOutlet: { label: "신세계 아울렛", aliases: ["신세계 아울렛", "신세계아울렛", "신세계 프리미엄 아울렛", "신세계프리미엄아울렛"] },
  lotteDepartment: { label: "롯데백화점", aliases: ["롯데백화점", "롯데 백화점", "LOTTE DEPARTMENT"] },
  lotteOutlet: { label: "롯데아울렛", aliases: ["롯데아울렛", "롯데 아울렛", "LOTTE OUTLET"] },
});

const TRUSTED_LABELS = Object.freeze({
  naver: ["브랜드직영몰", "백화점", "아울렛"],
  ssg: ["신세계백화점", "SSG 백화점", "신세계 아울렛", "신세계프리미엄아울렛"],
  lotte: ["롯데백화점", "롯데아울렛"],
  musinsa: ["무신사"],
  twentyNineCm: ["29CM"],
  abcMart: ["ABC마트", "ABC MART", "ABC-MART"],
  siVillage: ["S.I.VILLAGE", "SIVILLAGE", "에스아이빌리지"],
});

const PARALLEL_PATTERN = /(?:병행\s*수입|해외\s*(?:직구|구매\s*대행|배송)|구매\s*대행|international\s*shipping|cross[- ]?border)/i;

export function domesticCardPlatform(store = "") {
  const value = normalize(store).toLowerCase();
  if (value.includes("네이버") || value.includes("naver")) return "naver";
  if (value.includes("ssg") || value.includes("신세계백화점") || value.includes("신세계 아울렛")) return "ssg";
  if (value.includes("롯데") || value.includes("lotte")) return "lotte";
  if (value.includes("무신사") || value.includes("musinsa")) return "musinsa";
  if (value.includes("29cm")) return "twentyNineCm";
  if (value.includes("abc마트") || value.includes("abc mart") || value.includes("abc-mart")) return "abcMart";
  if (value.includes("s.i.village") || value.includes("sivillage") || value.includes("에스아이빌리지") || value.includes("신세계 빌리지")) return "siVillage";
  return "";
}

export function trustedDomesticCardLabels(store = "") {
  return TRUSTED_LABELS[domesticCardPlatform(store)] || [];
}

export function trustedAccountSheetRetailer(store = "", evidence = "") {
  const haystack = normalize([store, evidence].filter(Boolean).join(" ")).toLowerCase();
  if (!haystack) return null;
  for (const [platform, entry] of Object.entries(ACCOUNT_SHEET_TRUSTED_RETAILERS)) {
    if (entry.aliases.some((alias) => haystack.includes(String(alias).toLowerCase()))) {
      return { platform, ...entry };
    }
  }
  return null;
}

export function evaluateDomesticProductCard({ store = "", articleNumber = "", text = "", markup = "" } = {}) {
  const platform = domesticCardPlatform(store);
  const evidence = normalize([text, markup].filter(Boolean).join(" "));
  const code = normalize(articleNumber).toUpperCase();
  const normalizedEvidence = evidence.toUpperCase();
  const codeMatched = !code || normalizedEvidence.includes(code);
  const labels = trustedDomesticCardLabels(store).filter((label) => evidence.toLowerCase().includes(String(label).toLowerCase()));
  const parallelImport = PARALLEL_PATTERN.test(evidence);
  const accountRetailer = trustedAccountSheetRetailer(store, evidence);

  // 정품 판정 기준:
  // 1) Google Drive 계정정보 시트에 등록된 신뢰 판매처의 실제 상품 카드이고
  // 2) 그 카드 안에서 검색한 정확 상품코드가 확인되며
  // 3) 병행수입/해외직구/구매대행 표기가 없어야 한다.
  // 네이버/SSG/롯데ON에서는 기존의 카드 내부 공식 유통 라벨도 동일한 신뢰 근거로 인정한다.
  const accountSheetEvidence = Boolean(accountRetailer && codeMatched && !parallelImport);
  const platformLabelEvidence = Boolean(codeMatched && labels.length > 0 && !parallelImport);
  const trusted = accountSheetEvidence || platformLabelEvidence;
  return {
    platform,
    codeMatched,
    parallelImport,
    labels,
    accountSheetRetailer: accountRetailer?.label || "",
    accountSheetEvidence,
    platformLabelEvidence,
    trusted,
    verdict: trusted ? "confirmed" : "absent",
  };
}

export function evaluateDomesticProductCards({ store = "", articleNumber = "", cards = [] } = {}) {
  const evaluated = (Array.isArray(cards) ? cards : []).map((card) => evaluateDomesticProductCard({
    store,
    articleNumber,
    text: card?.text || card?.innerText || "",
    markup: card?.markup || card?.html || "",
  }));
  const trustedCard = evaluated.find((card) => card.trusted);
  return {
    trusted: Boolean(trustedCard),
    verdict: trustedCard ? "confirmed" : "absent",
    labels: [...new Set(evaluated.flatMap((card) => card.labels))],
    accountSheetRetailer: trustedCard?.accountSheetRetailer || "",
    accountSheetEvidence: trustedCard?.accountSheetEvidence === true,
    platformLabelEvidence: trustedCard?.platformLabelEvidence === true,
    cards: evaluated,
  };
}
