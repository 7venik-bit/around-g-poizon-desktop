import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../main.mjs", import.meta.url);
let source = await readFile(path, "utf8");

const oldSensitiveWork = `function hasActiveUpdateSensitiveWork() {\n  return brandExportJobPending || brandExportMonitorRunning || brandDownloadStarted;\n}`;
const newSensitiveWork = `function hasActiveUpdateSensitiveWork() {\n  // An idle monitor is intentionally long-lived and must not block an already\n  // downloaded application update. Only concrete export/download work is\n  // update-sensitive.\n  return brandExportJobPending || brandDownloadStarted || Boolean(activeBrandDownloadJobId);\n}`;

if (source.includes(oldSensitiveWork)) {
  source = source.replace(oldSensitiveWork, newSensitiveWork);
} else if (!source.includes("Boolean(activeBrandDownloadJobId)")) {
  throw new Error("Updater safety predicate anchor not found.");
}

const configureAnchor = `function configureUpdater() {\n  autoUpdater.autoDownload = true;`;
const configureReplacement = `function configureUpdater() {\n  // Do not rely solely on generated app-update.yml. Explicit GitHub feed\n  // configuration keeps existing installations able to discover releases\n  // even when older installers shipped incomplete updater metadata.\n  autoUpdater.setFeedURL({\n    provider: "github",\n    owner: "7venik-bit",\n    repo: "around-g-poizon-desktop",\n  });\n  autoUpdater.requestHeaders = {\n    "Cache-Control": "no-cache",\n    Pragma: "no-cache",\n  };\n  autoUpdater.autoDownload = true;`;

if (source.includes(configureAnchor)) {
  source = source.replace(configureAnchor, configureReplacement);
} else if (!source.includes('owner: "7venik-bit"') || !source.includes('repo: "around-g-poizon-desktop"')) {
  throw new Error("Updater configuration anchor not found.");
}

const retryOld = `const UPDATE_RETRY_INTERVAL_MS = 15 * 60 * 1_000;`;
const retryNew = `const UPDATE_RETRY_INTERVAL_MS = 60 * 1_000;`;
if (source.includes(retryOld)) source = source.replace(retryOld, retryNew);

await writeFile(path, source, "utf8");
console.log("Updater reliability patch applied: idle monitor no longer blocks install; GitHub feed is explicit; retry is 60s.");
