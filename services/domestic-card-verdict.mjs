const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

const TRUSTED_LABELS = Object.freeze({
  naver: ["브랜드직영몰", "백화점", "아울렛"],
  ssg: ["신세계백화점", "SSG 백화점"],
  lotte: ["롯데백화점"],
});

const PARALLEL_PATTERN = /(?:병행\s*수입|해외\s*(?:직구|구매\s*대행|배송)|구매\s*대행|international\s*shipping|cross[- ]?border)/i;

export function domesticCardPlatform(store = "") {
  const value = normalize(store).toLowerCase();
  if (value.includes("네이버") || value.includes("naver")) return "naver";
  if (value.includes("ssg") || value.includes("신세계")) return "ssg";
  if (value.includes("롯데") || value.includes("lotte")) return "lotte";
  return "";
}

export function trustedDomesticCardLabels(store = "") {
  return TRUSTED_LABELS[domesticCardPlatform(store)] || [];
}

export function evaluateDomesticProductCard({ store = "", articleNumber = "", text = "", markup = "" } = {}) {
  const platform = domesticCardPlatform(store);
  const evidence = normalize([text, markup].filter(Boolean).join(" "));
  const code = normalize(articleNumber).toUpperCase();
  const normalizedEvidence = evidence.toUpperCase();
  const codeMatched = !code || normalizedEvidence.includes(code);
  const labels = trustedDomesticCardLabels(store).filter((label) => evidence.includes(label));
  const parallelImport = PARALLEL_PATTERN.test(evidence);
  const trusted = codeMatched && !parallelImport && labels.length > 0;
  return {
    platform,
    codeMatched,
    parallelImport,
    labels,
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
    cards: evaluated,
  };
}
