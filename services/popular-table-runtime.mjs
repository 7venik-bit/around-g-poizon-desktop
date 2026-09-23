// Runs in the Seller Center frame. All operations resolve the same, smallest
// popular-products panel; a dashboard ancestor must never prove expansion.
export function popularTableRuntime(action = "state", options = {}) {
  const textOf = (element) => String(element?.innerText || element?.textContent || "");
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth
      && style.display !== "none" && style.visibility !== "hidden";
  };
  const headingSelector = "h1, h2, h3, h4, strong, span, div";
  const headings = [...document.querySelectorAll(headingSelector)]
    .filter((element) => textOf(element).trim() === "인기상품"
      && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
  const panels = [];
  for (const heading of headings) {
    let panel = heading.parentElement;
    for (let depth = 0; panel && depth < 12; depth += 1, panel = panel.parentElement) {
      const text = textOf(panel);
      const hasTableHeaders = text.includes("SPU 기준") && text.includes("SKU 기준")
        && text.includes("상품정보") && /평균\s*거래가/.test(text);
      if (!hasTableHeaders) continue;
      // A page containing several cards is not the popular-products panel.
      const unrelatedHeading = [...panel.querySelectorAll(headingSelector)].some((element) =>
        /^(?:top\s*브랜드|신규 인기상품|인기 카테고리|top\s*카테고리)$/i.test(textOf(element).trim()));
      if (!unrelatedHeading && visible(panel)) {
        const rect = panel.getBoundingClientRect();
        const expanded = rect.width >= innerWidth * 0.8 && rect.height >= innerHeight * 0.65;
        panels.push({ panel, heading, rect, expanded });
      }
      // Never keep climbing until the whole page happens to fill the viewport.
      break;
    }
  }
  panels.sort((a, b) => Number(b.expanded) - Number(a.expanded)
    || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  const match = panels[0];
  if (!match) return { found: false, expanded: false, scopeVerified: false, reason: "popular_panel_missing" };
  const { panel, heading, rect, expanded } = match;
  const state = { found: true, expanded, scopeVerified: expanded };
  if (action === "state") return state;
  if (action === "expand") {
    if (expanded) return { ...state, alreadySelected: true };
    const headingRect = heading.getBoundingClientRect();
    const metadata = (element) => [element.getAttribute("aria-label"), element.getAttribute("title"),
      element.getAttribute("data-icon"), element.getAttribute("class"),
      ...[...element.querySelectorAll("use")].map((node) => node.getAttribute("href") || node.getAttribute("xlink:href"))].join(" ");
    const controls = [...panel.querySelectorAll("button, [role='button'], svg, i, [class*='icon'], [title], [aria-label]")]
      .filter(visible).map((element) => ({ element, rect: element.getBoundingClientRect(), meta: metadata(element) }))
      .filter((control) => control.rect.width >= 8 && control.rect.width <= 64
        && control.rect.height >= 8 && control.rect.height <= 64
        && Math.abs((control.rect.top + control.rect.bottom - headingRect.top - headingRect.bottom) / 2) <= 24
        && control.rect.left >= rect.right - 110 && !/refresh|reload|새로|刷新/i.test(control.meta))
      .sort((a, b) => Number(/fullscreen|expand|全屏|放大|확대|전체화면/i.test(b.meta))
        - Number(/fullscreen|expand|全屏|放大|확대|전체화면/i.test(a.meta)) || b.rect.right - a.rect.right);
    const control = controls[0]?.element;
    if (!control) return { ...state, found: false, reason: "expand_control_missing" };
    const target = control.closest("button, [role='button']") || control;
    // DOM dispatch stays in this frame, unlike viewport coordinates sent to
    // the outer Electron window (which can hit refresh or the page behind it).
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return { ...state, clicked: true };
  }
  if (!expanded) return { ...state, found: false, reason: "popular_panel_not_expanded" };

  const root = document.scrollingElement || document.documentElement;
  const ancestors = [];
  for (let parent = panel.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
  const scrollCandidates = [panel, ...panel.querySelectorAll("div, section, main, article, [role='grid'], [role='table'], tbody"), ...ancestors, root]
    .filter((element, index, all) => element && all.indexOf(element) === index)
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const style = getComputedStyle(element);
      const ownRows = panel.contains(element)
        && Boolean(element.querySelector("tr, [role='row'], [class*='row'], [class*='item']"));
      const ancestor = element === panel || element.contains(panel);
      const scrollable = /auto|scroll|overlay/i.test(style.overflowY)
        || element === root;
      return { element, bounds, maximum, ownRows, ancestor, scrollable };
    })
    .filter(({ element, bounds, maximum, ownRows, ancestor, scrollable }) =>
      (ownRows || ancestor) && scrollable && maximum > 2 && visible(element) && bounds.width >= 200
      && bounds.height >= 100)
    // The internal table viewport wins over the page or a surrounding modal.
    .sort((a, b) => Number(b.ownRows) - Number(a.ownRows)
      || a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  const scrollTarget = scrollCandidates[0];
  if (action === "capture") {
    const selector = "tr, [role='row'], li, [class*='row'], [class*='item'], [class*='product']";
    const collected = new Map();
    for (const element of panel.querySelectorAll(selector)) {
      const text = textOf(element).trim();
      if (!text || text.length > 3000 || !visible(element)) continue;
      const imageUrl = element.querySelector("img[src]")?.src || "";
      collected.set(text + "\n" + imageUrl, { text, imageUrl });
    }
    const nodes = [...collected.values()];
    return { ...state, text: nodes.map((node) => node.text).join("\n"), title: document.title,
      url: location.href, nodes, scannedNodeCount: nodes.length,
      signature: nodes.map((node) => node.text + "|" + node.imageUrl).join("||"),
      scrollTop: Number(scrollTarget?.element.scrollTop || 0), scrollMaximum: Number(scrollTarget?.maximum || 0) };
  }
  if (!scrollTarget) return { ...state, found: false, moved: false, atEnd: true, reason: "popular_scroll_missing" };
  const { element, maximum, bounds } = scrollTarget;
  const before = Number(element.scrollTop || 0);
  const viewportHeight = Math.max(1, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0));
  // Overlapping viewports keep virtual rows in both captures while avoiding
  // repeated waits for a sub-row movement that cannot repaint a new row yet.
  const step = Math.max(12, Math.floor(viewportHeight * 0.65));
  const desired = action === "jump" ? maximum * Math.max(0, Math.min(1, Number(options.ratio) || 0))
    : action === "nudge" ? before + Number(options.pixels || 0) : before + step;
  element.scrollTop = Math.max(0, Math.min(maximum, Math.round(desired)));
  element.dispatchEvent(new Event("scroll", { bubbles: true }));
  const after = Number(element.scrollTop || 0);
  return { ...state, before, after, maximum, step, moved: after !== before, atEnd: after >= maximum - 2 };
}

export function popularTableScript(action, options = {}) {
  return `(${popularTableRuntime.toString()})(${JSON.stringify(action)}, ${JSON.stringify(options)})`;
}
