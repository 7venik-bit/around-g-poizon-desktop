import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("starting a batch product search jumps to the radar progress", () => {
  const start = renderer.indexOf("renderBatchSearchProgress(0);");
  assert.notEqual(start, -1);
  const following = renderer.slice(start, start + 600);
  assert.match(following, /\$\("#domestic-loading-banner"\)\?\.scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/);
});
