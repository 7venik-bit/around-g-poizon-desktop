import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Release regression guard.
const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("every release workflow preserves the canonical Naver implementation", async () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/windows-package-test.yml",
  ]) {
    const workflow = await read(path);
    assert.doesNotMatch(workflow, /patch-official-trust-and-search-result/);
    assert.doesNotMatch(workflow, /verify-official-trust-and-search-result/);
  }
});

test("the remaining build patch preserves the canonical Naver overview flow", async () => {
  const patchSource = await read("scripts/patch-simplify-official-naver-search.mjs");
  assert.match(patchSource, /canonical application now owns Naver's visible card-list flow/);
  assert.match(patchSource, /if \(false\) relay = replaceOnce/);
  assert.match(patchSource, /if \(false\) renderer = replaceOnce/);
  assert.match(patchSource, /canonical Naver card-list logic preserved/);
});

test("the packaged-source verifier rejects duplicate Naver source rows", async () => {
  const verifier = await read("scripts/verify-simplify-official-naver-search.mjs");
  assert.match(verifier, /articleTextCardLinks/);
  assert.match(verifier, /cardCollectionMissed/);
  assert.match(verifier, /still runs as a duplicate Naver search/);
});

for (const newline of ["\n", "\r\n"]) test(`release finalizer preserves current retailer collection with ${newline.length === 1 ? 'LF' : 'CRLF'} source`, async t => {
  const folder=await mkdtemp(join(tmpdir(),'aroundg-finalizer-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const main=(await read('main.mjs')).replace(/\r\n/g,'\n');
  const patch=await read('scripts/patch-naver-result-link-finalizer.mjs');
  await mkdir(join(folder,'scripts'));
  await writeFile(join(folder,'main.mjs'),main.replace(/\n/g,newline));
  await writeFile(join(folder,'scripts','patch-naver-result-link-finalizer.mjs'),patch);
  execFileSync(process.execPath,[join(folder,'scripts','patch-naver-result-link-finalizer.mjs')]);
  assert.equal(await readFile(join(folder,'main.mjs'),'utf8'),main,'release patch must preserve the current source, including session, stock and error handling');
});
