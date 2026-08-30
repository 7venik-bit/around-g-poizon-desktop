import { readFile } from "node:fs/promises";

// Legacy compatibility command. The approved mascot is now a real multi-frame
// GIF loaded directly by renderer.js; never rebuild it from layered fragments.
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
if (!renderer.includes("./assets/otter-typing-tail-sway.gif")) {
  throw new Error("canonical multi-frame otter GIF is missing from renderer.js");
}
if (renderer.includes("otter-typing-paw-layer") || renderer.includes("APPROVED_OTTER_IMAGE_SRC")) {
  throw new Error("legacy layered otter animation is still present");
}

console.log("canonical multi-frame otter GIF is already installed; no source mutation applied");
