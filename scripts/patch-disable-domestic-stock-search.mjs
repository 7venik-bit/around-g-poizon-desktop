import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`stock-search patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`stock-search patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

// 국내 상품 검색은 정확한 상품/가격을 찾는 데만 사용한다.
// 재고와 사이즈는 사용자가 판매처 화면에서 직접 확인하므로 모든 판매처에서
// 자동 옵션 클릭과 재고 DOM 판정을 생략해 검색 시간을 줄이고 실패 지점을 없앤다.
main = replaceOnce(
  main,
  "          await openRenderedSizeOptions(searchWindow);",
  "          // 재고·사이즈 자동 확인 안 함: 판매처에서 사용자가 직접 확인",
  "remove rendered size-option interaction",
);

const stockPattern = /          const rawStock = await searchWindow\.webContents\.executeJavaScript\(`\(\(\) => \{[\s\S]*?          if \(rawStock\) stockEvidence = normalizeRenderedStockEvidence\(rawStock\);\n/;
const stockMatch = main.match(stockPattern);
if (!stockMatch) throw new Error("stock-search patch target missing: stock extraction block");
main = main.replace(
  stockPattern,
  "          stockEvidence = { inStock: null, sizes: [], stockStatus: \"manual_check\", stockVerified: false };\n",
);

await writeFile(mainPath, main, "utf8");
console.log("domestic inventory automation disabled; product and price search remains enabled");
