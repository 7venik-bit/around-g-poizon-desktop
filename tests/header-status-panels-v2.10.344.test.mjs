import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("the audit, recovery, and folder panels move into the upper navy header", () => {
  const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";
  for (const id of [
    "official-domain-audit-toggle",
    "weekly-site-health",
    "startup-recovery",
    "brand-export-folder-path",
  ]) assert.match(header, new RegExp(`id="${id}"`));
  assert.match(header, /class="header-status-stack"/);
});

test("the moved status panels use a compact two-column header layout", () => {
  assert.match(style, /\.header-status-stack\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(style, /body \.shell>header\{[\s\S]*?grid-template-columns:auto minmax\(440px,1fr\) auto/);
  assert.match(style, /\.header-status-stack button\{[\s\S]*?font-size:9px/);
});

test("status panel ids remain unique after relocation", () => {
  for (const id of [
    "official-domain-audit-toggle",
    "weekly-site-health",
    "startup-recovery",
    "brand-export-folder-path",
  ]) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
});
