import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`SSG session-reset verification failed: ${message}`); };

if (!main.includes('origin: "https://www.ssg.com"')) fail("SSG-only storage origin is missing");
if (!main.includes('storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"]')) fail("SSG storage reset list is missing");
if (!main.includes("await ssgSession.clearCache();")) fail("search cache reset is missing");
if (!main.includes('ssg_access_limited_after_session_reset')) fail("post-reset SSG failure state is missing");
if (!main.includes('ssgChannelSource && securityRetry < 1')) fail("single SSG reset retry guard is missing");
if (!main.includes('String(resolvedSource.verificationReason || "") !== "ssg_access_limited_after_session_reset"')) fail("deferred retry is not suppressed after reset retry");

console.log("SSG session-reset verification passed");
