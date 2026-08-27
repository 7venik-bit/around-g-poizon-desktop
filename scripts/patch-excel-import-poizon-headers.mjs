import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`excel import patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`excel import patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

const oldImport = `    const sheet = await readFirstDataSheet(await readFile(filePath));
    const headers = (sheet[0] || []).map((value) => String(value || "").trim());
    const rows = sheet.slice(1).map((values) => Object.fromEntries(
      headers.flatMap((header, index) => header ? [[header, values[index] ?? ""]] : [])
    ));
    let imported = 0;
    for (const row of rows) {
      const articleNumber = String(row["상품번호"] || row.articleNumber || row["품번"] || "").trim();
      const name = String(row["상품명"] || row.name || "").trim();
      if (!articleNumber && !name) continue;
      await store.upsert("products", {
        articleNumber,
        name,
        brand: String(row["브랜드"] || row.brand || ""),
        spuId: String(row["SPU ID"] || row.spuId || ""),
        poizonPrice: Number(row["POIZON 가격"] || row.poizonPrice || 0),
        domesticPrice: Number(row["국내 가격"] || row.domesticPrice || 0),
        source: "excel"
      });
      imported += 1;
    }
    return { canceled: false, imported };`;

const newImport = `    const sheet = await readFirstDataSheet(await readFile(filePath));
    if (!Array.isArray(sheet) || sheet.length < 1) {
      return { canceled: false, imported: 0, message: "Excel 파일에 읽을 수 있는 데이터가 없습니다." };
    }

    // POIZON exports do not always use the exact same spelling for headers
    // (for example \"상품 번호\" vs \"상품번호\"). Reuse the tolerant POIZON
    // header matcher instead of relying on exact object keys. Also tolerate a
    // few title rows above the actual header row.
    const headerCandidates = sheet.slice(0, Math.min(20, sheet.length));
    let headerRowIndex = 0;
    let bestHeaderScore = -1;
    for (let index = 0; index < headerCandidates.length; index += 1) {
      const candidate = Array.isArray(headerCandidates[index]) ? headerCandidates[index] : [];
      const score = [
        findPoizonColumn(candidate, "상품 번호", "상품번호", "품번", "상품코드", "제품코드", "Article Number", "articleNumber"),
        findPoizonColumn(candidate, "상품명", "상품 이름", "제품명", "상품정보", "상품 정보", "Product Name", "name"),
        findPoizonColumn(candidate, "SPU ID", "SPU_ID", "SPUID"),
        findPoizonColumn(candidate, "브랜드", "브랜드명", "Brand"),
      ].filter((column) => column >= 0).length;
      if (score > bestHeaderScore) {
        bestHeaderScore = score;
        headerRowIndex = index;
      }
    }

    const headers = (sheet[headerRowIndex] || []).map((value) => String(value || "").trim());
    const columns = {
      articleNumber: findPoizonColumn(headers, "상품 번호", "상품번호", "품번", "상품코드", "제품코드", "Article Number", "articleNumber"),
      name: findPoizonColumn(headers, "상품명", "상품 이름", "제품명", "상품정보", "상품 정보", "Product Name", "name"),
      brand: findPoizonColumn(headers, "브랜드", "브랜드명", "Brand"),
      spuId: findPoizonColumn(headers, "SPU ID", "SPU_ID", "SPUID"),
      poizonPrice: findPoizonColumn(headers, "POIZON 가격", "포이즌 가격", "평균 거래가", "평균거래가", "poizonPrice"),
      domesticPrice: findPoizonColumn(headers, "국내 가격", "국내가격", "domesticPrice"),
      imageUrl: findPoizonColumn(headers, "상품 이미지", "상품이미지", "이미지", "imageUrl", "image"),
    };

    const valueAt = (row, column) => column >= 0 ? row?.[column] ?? "" : "";
    let imported = 0;
    for (const values of sheet.slice(headerRowIndex + 1)) {
      const row = Array.isArray(values) ? values : [];
      const articleNumber = String(valueAt(row, columns.articleNumber) || "").trim();
      const name = String(valueAt(row, columns.name) || "").trim();
      if (!articleNumber && !name) continue;
      await store.upsert("products", {
        articleNumber,
        name,
        brand: String(valueAt(row, columns.brand) || "").trim(),
        spuId: String(valueAt(row, columns.spuId) || "").trim(),
        poizonPrice: Number(String(valueAt(row, columns.poizonPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        domesticPrice: Number(String(valueAt(row, columns.domesticPrice) || 0).replace(/[^0-9.-]/g, "")) || 0,
        imageUrl: String(valueAt(row, columns.imageUrl) || "").trim(),
        source: "excel"
      });
      imported += 1;
    }

    const identityColumnFound = columns.articleNumber >= 0 || columns.name >= 0;
    return {
      canceled: false,
      imported,
      headerRow: headerRowIndex + 1,
      message: imported > 0 ? "" : identityColumnFound
        ? "Excel 파일은 열었지만 상품 데이터 행을 찾지 못했습니다."
        : `Excel 파일은 열었지만 상품번호/상품명 열을 찾지 못했습니다. 인식한 헤더: ${headers.filter(Boolean).slice(0, 12).join(", ") || "없음"}`,
    };`;

main = replaceOnce(main, oldImport, newImport, "tolerant POIZON Excel import");
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
const oldButton = `$("#import-button").addEventListener("click", async () => {
  const result = await window.aroundG.importExcel();
  if (!result.canceled) {
    await refresh();
    alert(\`${'${result.imported}'}개 상품을 로컬에 가져왔습니다.\`);
  }
});`;
const newButton = `$("#import-button").addEventListener("click", async () => {
  const button = $("#import-button");
  if (button) button.disabled = true;
  try {
    const result = await window.aroundG.importExcel();
    if (result?.canceled) return;
    if (Number(result?.imported || 0) > 0) {
      await refresh();
      alert(\`${'${Number(result.imported || 0).toLocaleString("ko-KR")}'}개 상품을 로컬에 가져왔습니다.\`);
      return;
    }
    alert(String(result?.message || "Excel 파일은 열었지만 가져올 상품 데이터를 찾지 못했습니다."));
  } catch (error) {
    alert(\`Excel 가져오기 실패: ${'${error?.message || error || "알 수 없는 오류"}'}\`);
  } finally {
    if (button) button.disabled = false;
  }
});`;
renderer = replaceOnce(renderer, oldButton, newButton, "Excel import result feedback");
await writeFile(rendererPath, renderer, "utf8");

console.log("Excel import now recognizes POIZON header variants and reports zero-import causes");
