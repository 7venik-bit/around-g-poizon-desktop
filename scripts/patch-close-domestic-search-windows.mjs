import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const before = `    const keepSharedNaverWindow = naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;
const after = `    const keepSharedNaverWindow = [\n      "네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛",\n    ].includes(String(source.store || ""))\n      && naverPortalSource\n      && sharedNaverSession?.window === searchWindow;`;

if (!source.includes(before)) {
  if (source.includes(after)) {
    console.log("domestic search-window close patch already applied");
    process.exit(0);
  }
  throw new Error("domestic search-window close patch target missing");
}

source = source.replace(before, after);
await writeFile(mainPath, source, "utf8");
console.log("domestic search windows now close after each simplified search");
