export function officialSearchModule({ store, officialStatus, homepageUrl }) {
  return [{
    id: "official",
    module: "official",
    store,
    linkOnly: true,
    officialBrand: true,
    renderCount: ["verified", "search_unsupported"].includes(officialStatus) && Boolean(homepageUrl),
    officialStatus,
    homepageUrl,
  }];
}
