import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("an exact Musinsa detail product becomes the cross-store image reference", () => {
  assert.match(main, /async function verifyAllStoresWithMusinsaImage/);
  assert.match(main, /String\(product\?\.sourceStore \|\| product\?\.store \|\| ""\) === "무신사"/);
  assert.match(main, /Number\(product\?\.signals\?\.codeScore \|\| 0\) === 1/);
  assert.match(main, /referenceStore: "무신사"/);
});

test("all store results are checked after rendered search confidence", () => {
  assert.match(main, /matched = await addMatchConfidence\(matched, input \|\| \{\}\);\n\s*matched = await verifyAllStoresWithMusinsaImage/);
  assert.match(main, /musinsaImageRejected: imageScore < 58/);
  assert.match(main, /verified\.filter\(\(product\) => product\.musinsaImageRejected !== true\)/);
});

test("missing candidate images remain reviewable instead of becoming false absence", () => {
  assert.match(main, /musinsaImageCompared: false, imageVerificationLabel: "이미지 확인 필요"/);
});
