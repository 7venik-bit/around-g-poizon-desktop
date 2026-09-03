import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("update events are persisted in the in-app notification center", async () => {
  const [main, preload, html, renderer] = await Promise.all([
    readFile(new URL("main.mjs", root), "utf8"),
    readFile(new URL("preload.cjs", root), "utf8"),
    readFile(new URL("src/index.html", root), "utf8"),
    readFile(new URL("src/renderer.js", root), "utf8"),
  ]);
  assert.match(main, /programNotifications/);
  assert.match(main, /업데이트 설치 완료/);
  assert.match(main, /notifications:list/);
  assert.match(preload, /getNotifications/);
  assert.match(preload, /markNotificationsRead/);
  assert.match(html, /id="notification-open"/);
  assert.match(html, /id="notification-dialog"/);
  assert.match(renderer, /renderProgramNotifications/);
});

test("work-wait update status does not create a duplicate completion alert", async () => {
  const main = await readFile(new URL("main.mjs", root), "utf8");
  assert.match(main, /status === "downloaded" && extra\.waitingForWork/);
});
