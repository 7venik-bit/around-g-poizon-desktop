import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = (await readFile(new URL("../src/style.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("popular panel heading is centered", () => {
  assert.match(css, /#explorer-popular\.panel>small,#explorer-popular\.panel>h2\{[^}]*text-align:center/);
});
