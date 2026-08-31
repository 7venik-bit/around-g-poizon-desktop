const priceAmount = (value) => {
  const amount = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(amount) && amount >= 1_000 && amount <= 100_000_000 ? amount : 0;
};

function excludedPriceKind(prefix = "", suffix = "") {
  const nearby = String(prefix || "").replace(/\s+/g, " ").slice(-28);
  const following = String(suffix || "").replace(/\s+/g, " ").slice(0, 28);
  if (/무료\s*배송\s*$/i.test(nearby)) return "";
  if (/(?:배송(?:비|료|옵션)?|택배|착불|도서산간|제주(?:지역)?|반품비|교환비)\s*(?:비용)?\s*[:：]?\s*$/i.test(nearby)) {
    return "shipping";
  }
  if (/(?:적립|포인트|혜택|캐시|마일리지|최대\s*적립)\s*(?:금|액)?\s*[:：]?\s*$/i.test(nearby)) {
    return "benefit";
  }
  if (/^\s*(?:추가\s*)?(?:적립(?:금|액|\s*포인트)?|포인트|캐시|마일리지)/i.test(following)) return "benefit";
  if (/(?:월|월납|할부|렌탈료)\s*[:：]?\s*$/i.test(nearby)) return "installment";
  return "";
}

export function isDomesticNaverPriceCard(card = {}) {
  const productUrl = String(card?.productUrl || "");
  const evidence = [card?.title, card?.text, card?.markup].filter(Boolean).join(" ").replace(/\s+/g, " ");
  if (/\/window-products\/(?:foreign|overseas|global)(?:\/|$)/i.test(productUrl)) return false;
  if (/(?:해외\s*직구|해외\s*구매|해외\s*배송|구매\s*대행|관부가세(?:가)?\s*포함|해외\s*상품)/i.test(evidence)) return false;
  return true;
}

export function selectNaverSellingPrices(text = "") {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const sellingAmounts = [];
  const excludedShippingAmounts = [];
  const excludedOtherAmounts = [];
  for (const match of source.matchAll(/([1-9][\d,]{2,})\s*원/g)) {
    const amount = priceAmount(match[1]);
    if (!amount) continue;
    const matchIndex = Number(match.index || 0);
    const kind = excludedPriceKind(
      source.slice(Math.max(0, matchIndex - 28), matchIndex),
      source.slice(matchIndex + match[0].length, matchIndex + match[0].length + 28),
    );
    if (kind === "shipping") excludedShippingAmounts.push(amount);
    else if (kind) excludedOtherAmounts.push(amount);
    else sellingAmounts.push(amount);
  }
  const unique = [...new Set(sellingAmounts)].sort((left, right) => left - right);
  return {
    price: unique[0] || 0,
    originalPrice: unique.at(-1) || 0,
    sellingAmounts: unique,
    excludedShippingAmounts: [...new Set(excludedShippingAmounts)],
    excludedOtherAmounts: [...new Set(excludedOtherAmounts)],
  };
}
