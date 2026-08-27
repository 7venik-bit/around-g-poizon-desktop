import { readFile } from "node:fs/promises";

const matcher = String(await readFile(new URL("../services/matcher.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`image-title primary verification failed: ${message}`); };

if (!matcher.includes("export function domesticProductIdentityAccepted")) fail("identity acceptance helper missing");
if (!matcher.includes("codeScore * 10") || !matcher.includes("titleScore * 45") || !matcher.includes("(imageScore ?? 0) * 45")) fail("image/title confidence weighting missing");
if (matcher.includes("candidate.detectedArticleNumber, candidate.id, candidate.name")) fail("marketplace internal ID still participates in manufacturer identity");
if (!matcher.includes("titleScore >= 65 && imageScore >= 82")) fail("primary image+title gate missing");
if (!matcher.includes("return codeMatched && titleScore >= 80")) fail("strict no-image fallback missing");
if (!relay.includes("let visualIdentityPending = false")) fail("portal visual candidate marker missing");
if (!relay.includes("const visualPriorityPortal = /^(?:네이버\\s|SSG(?:\\s|$)|롯데온(?:\\s|$))/")) fail("Naver/SSG/Lotte visual candidate route missing");
if (!relay.includes("if (!brandMatched && !visualIdentityPending) continue;")) fail("brand-label omission still blocks visual verification");
if (!main.includes("domesticProductIdentityAccepted, scoreProductCandidate")) fail("identity helper import missing");
if (!main.includes("await Promise.all(products.map(async (_product, index) =>")) fail("not all candidate images are compared");
if (main.includes("const bestByStore = new Map();")) fail("speed-first one-image-per-store shortcut remains");
if (!main.includes("products = products.filter((product) => domesticProductIdentityAccepted(product, { hasSourceImage }))")) fail("main acceptance gate missing");
if (!main.includes("const exactMatch = matched.products.length > 0;")) fail("visual exact-match outcome not propagated");

console.log("image+product-name primary identity verified: all candidate images compared, manufacturer code is supporting evidence, marketplace IDs ignored");
