import { readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lockUrl = new URL("../package-lock.json", import.meta.url);
const lockJson = JSON.parse(await readFile(lockUrl, "utf8"));

lockJson.version = packageJson.version;
lockJson.packages ??= {};
lockJson.packages[""] ??= {};
lockJson.packages[""].version = packageJson.version;

await writeFile(lockUrl, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8");
