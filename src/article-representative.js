(() => {
  if (globalThis.AroundGArticleRepresentative) return;

  // One domestic search per article number, using the highest-price row.
  // Size/option rows of the same product stay visible but are never searched
  // themselves. The workbook is never modified; this only decides which rows
  // the search buttons submit.
  const normalizeArticleGroupKey = (articleNumber = "", brand = "") => {
    const clean = (value) => String(value || "").toLocaleLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    return [clean(articleNumber), clean(brand)].join("|");
  };

  const articleRowPrice = (product = {}) => {
    const direct = Number(product?.averagePrice);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const raw = [product?.originalValues?.averagePrice, product?.averagePrice]
      .map((value) => String(value ?? "")).join(" ");
    const amount = Number(raw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };

  const selectArticlePriceRepresentatives = (rows = []) => {
    const list = Array.isArray(rows) ? rows : [];
    const groups = new Map();
    const singletons = [];
    for (const row of list) {
      const key = String(row?.key ?? "");
      if (!key) continue;
      const article = String(row?.product?.articleNumber || row?.articleNumber || "").trim();
      if (!article) {
        singletons.push(key);
        continue;
      }
      const groupKey = normalizeArticleGroupKey(
        article,
        row?.product?.brandName || row?.product?.brand || row?.brand || "",
      );
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ key, product: row?.product || {}, price: articleRowPrice(row?.product || {}) });
    }
    const representativeKeys = [...singletons];
    const representativeOf = {};
    for (const key of singletons) representativeOf[key] = key;
    for (const members of groups.values()) {
      let best = members[0];
      for (const member of members.slice(1)) {
        if (member.price > best.price) best = member;
      }
      representativeKeys.push(best.key);
      for (const member of members) representativeOf[member.key] = best.key;
    }
    const representativeSet = new Set(representativeKeys);
    const skippedKeys = list
      .map((row) => String(row?.key ?? ""))
      .filter((key) => key && !representativeSet.has(key));
    return { representativeKeys, representativeOf, skippedKeys };
  };

  globalThis.AroundGArticleRepresentative = Object.freeze({
    normalizeArticleGroupKey,
    articleRowPrice,
    selectArticlePriceRepresentatives,
  });
})();
