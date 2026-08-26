import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const required = `    const keepSharedNaverWindow = naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;

if (!main.includes(required)) {
  throw new Error("persistent Naver result-window verification failed");
}
if (!main.includes("if (searchWindow && !searchWindow.isDestroyed() && !keepSharedNaverWindow) searchWindow.destroy();")) {
  throw new Error("search-window close verification failed: final window destroy is missing");
}
console.log("persistent Naver result-window verification passed");
