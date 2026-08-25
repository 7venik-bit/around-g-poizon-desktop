import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const required = `    const keepSharedNaverWindow = [\n      "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛",\n    ].includes(String(source.store || ""))\n      && naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;

if (!main.includes(required)) {
  throw new Error("search-window close verification failed: simplified Naver search can still keep its window alive");
}
if (!main.includes("if (searchWindow && !searchWindow.isDestroyed() && !keepSharedNaverWindow) searchWindow.destroy();")) {
  throw new Error("search-window close verification failed: final window destroy is missing");
}
console.log("domestic search-window close verification passed");
