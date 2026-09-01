import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");

const original = `      // Establish Naver cookies/session on the normal home page first. A
      // cold hidden window can reject a direct Fashion Town SPA navigation.
      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;`;

const patched = `      // Direct Fashion Town result URLs must not depend on a Naver-home bootstrap.
      // The home navigation is the recurring source of Electron page-load failures.
      const initialUrl = directNaverFashionResult
        ? url
        : (naverPortalSource ? "https://www.naver.com/" : url);
      /*
      // Establish Naver cookies/session on the normal home page first. A
      // cold hidden window can reject a direct Fashion Town SPA navigation.
      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;
      */`;

if (!source.includes(patched)) {
  const first = source.indexOf(original);
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error("Cannot patch Naver direct-result bootstrap: expected one source anchor.");
  }
  source = source.slice(0, first) + patched + source.slice(first + original.length);
}

await writeFile(mainPath, source, "utf8");
console.log("Naver direct Fashion Town result bootstrap patched");
