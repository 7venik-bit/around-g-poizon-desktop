import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);
let main = await readFile(mainPath, "utf8");
let preload = await readFile(preloadPath, "utf8");

const mainAnchor = '  ipcMain.handle("musinsa-auto-purchase:validate", (_event, order = {}) => {';
if (!main.includes(mainAnchor)) throw new Error("Musinsa auto-purchase foundation must be applied first");
if (!main.includes('ipcMain.handle("musinsa-stock:check"')) {
  const block = `  ipcMain.handle("musinsa-stock:check", async (_event, input = {}) => {\n    const url = String(input.url || "").trim();\n    const id = url.match(/musinsa\\.com\\/products?\\/(\\d+)/i)?.[1] || url.match(/[?&](?:goodsNo|goods_no)=(\\d+)/i)?.[1] || "";\n    if (!id) return { ok: false, code: "INVALID_MUSINSA_URL", message: "무신사 상품 링크를 확인해 주세요." };\n    try {\n      const response = await net.fetch(\`https://api.musinsa.com/api2/dp/v1/plp/goods/\${encodeURIComponent(id)}/options\`, {\n        headers: { Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9" },\n      });\n      if (!response.ok) return { ok: false, code: \`MUSINSA_HTTP_\${response.status}\`, productId: id };\n      const document = await response.json();\n      const flatten = (options = []) => options.flatMap((option) => {\n        const children = flatten(Array.isArray(option?.goodsOptions) ? option.goodsOptions : []);\n        if (children.length) return children;\n        const label = String(option?.name || option?.code || "").trim();\n        if (!label) return [];\n        return [{ label, inStock: option?.outOfStock !== true }];\n      });\n      const sizes = flatten(document?.data?.goodsOptions || []);\n      return { ok: true, productId: id, url, inStock: sizes.some((size) => size.inStock), sizes, checkedAt: new Date().toISOString() };\n    } catch (error) {\n      return { ok: false, code: "MUSINSA_STOCK_CHECK_FAILED", productId: id, message: error instanceof Error ? error.message : String(error) };\n    }\n  });\n`;
  main = main.replace(mainAnchor, block + mainAnchor);
}

const preloadAnchor = '  validateMusinsaAutoPurchase: (order) => ipcRenderer.invoke("musinsa-auto-purchase:validate", order),';
if (!preload.includes('checkMusinsaStock:')) {
  if (!preload.includes(preloadAnchor)) throw new Error("preload Musinsa foundation API missing");
  preload = preload.replace(preloadAnchor, `${preloadAnchor}\n  checkMusinsaStock: (input) => ipcRenderer.invoke("musinsa-stock:check", input),`);
}

await writeFile(mainPath, main, "utf8");
await writeFile(preloadPath, preload, "utf8");
console.log("Musinsa watchlist stock monitor bridge applied.");
