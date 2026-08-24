import { readFile, writeFile } from "node:fs/promises";
const target = new URL("../main.mjs", import.meta.url);
let source = await readFile(target, "utf8");
const marker = "const domesticLoginWindows = new Map();";
const signature = "releaseClosedAuxiliaryWindow";
if (!source.includes(signature)) {
  if (!source.includes(marker)) throw new Error("runtime marker missing");
  const addition = `${marker}\nfunction ${signature}(window) {\n  inventoryWindows.delete(window);\n  officialInteractiveWindows.delete(window);\n  for (const [key, value] of domesticLoginWindows.entries()) {\n    if (value === window) domesticLoginWindows.delete(key);\n  }\n  if (sellerMonitorWindow === window) sellerMonitorWindow = null;\n}\napp.on("browser-window-created", (_event, window) => {\n  window.once("closed", () => ${signature}(window));\n});`;
  source = source.replace(marker, addition);
}
await writeFile(target, source, "utf8");
console.log("Lightweight runtime cleanup applied.");
