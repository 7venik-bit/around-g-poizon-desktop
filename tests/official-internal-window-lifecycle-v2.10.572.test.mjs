import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("공식몰 내부 검색은 BrowserWindow와 webContents 생존 여부를 함께 확인한다", () => {
  assert.match(main, /function browserWindowUsable\(window\)/);
  assert.match(main, /!window\.isDestroyed\(\)/);
  assert.match(main, /!window\.webContents\.isDestroyed\(\)/);
  assert.match(main, /if \(!browserWindowUsable\(searchWindow\)\) return closedInternalSearchResult\(stage\)/);
});

test("파괴된 내부 검색창은 IPC 오류 대신 취소 결과로 종료한다", () => {
  assert.match(main, /reason: "INTERNAL_SEARCH_WINDOW_CLOSED"/);
  assert.match(main, /Object has been destroyed\|Render frame was disposed\|WebContents was destroyed/);
  assert.match(main, /return closedInternalSearchResult\("ipc_boundary"\)/);
});

test("사용자가 내부 검색창을 닫아도 인기리스트에 처리 오류를 표시하지 않는다", () => {
  assert.match(renderer, /const result = await window\.aroundG\.openOfficialInternalSearch/);
  assert.match(renderer, /if \(result\?\.canceled\) return/);
});
