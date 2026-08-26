import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const before = `    const keepSharedNaverWindow = naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;
const obsoleteClose = `    const keepSharedNaverWindow = [\n      "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛",\n    ].includes(String(source.store || ""))\n      && naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;

if (source.includes(obsoleteClose)) source = source.replace(obsoleteClose, before);
if (!source.includes(before)) throw new Error("persistent Naver result-window target missing");
await writeFile(mainPath, source, "utf8");
console.log("Naver result window remains available for in-app reopening");
