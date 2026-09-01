import { readFile, writeFile } from "node:fs/promises";

const registryPath = new URL("../services/official-domain-registry.mjs", import.meta.url);
let source = await readFile(registryPath, "utf8");

const keenEntry = '  { name: "킨", aliases: ["keen", "keen footwear", "keenfootwear", "킨"], domain: "keenfootwear.kr", homepageUrl: "https://keenfootwear.kr/", searchTemplate: "", interactiveSearch: true },';

if (!source.includes(keenEntry)) {
  const anchor = '  { name: "온", aliases: ["on", "on running", "onrunning", "온", "온러닝"], domain: "on.com", homepageUrl: "https://www.on.com/ko-kr/", searchTemplate: "https://www.on.com/ko-kr/search?q={query}" },';
  const index = source.indexOf(anchor);
  if (index < 0 || source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error("Cannot patch KEEN official mall: expected one curated-brand anchor.");
  }
  source = source.slice(0, index + anchor.length) + "\n" + keenEntry + source.slice(index + anchor.length);
}

await writeFile(registryPath, source, "utf8");
console.log("KEEN official mall registered: https://keenfootwear.kr/");
