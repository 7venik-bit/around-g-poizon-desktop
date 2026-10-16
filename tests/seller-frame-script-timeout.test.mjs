import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

function loadExecutor({ subframes = [], timeoutMs = 40, destroyWindow = false } = {}) {
  const start = main.indexOf("// Deadline for one seller-frame script.");
  assert.notEqual(start, -1);
  const end = main.indexOf("async function dragSellerScrollbarToRatio", start);
  assert.notEqual(end, -1);
  const slice = main.slice(start, end);
  assert.equal(slice.match(/20_000/g)?.length || 0, 1);
  const source = `${slice.replace("20_000", String(timeoutMs))}\nthis.executeAcrossSellerFrames = executeAcrossSellerFrames;`;
  const mainFrame = { routingId: 1, framesInSubtree: subframes };
  const sandbox = {
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sellerWindow: destroyWindow
      ? { webContents: { get mainFrame() { throw new Error("destroyed"); } } }
      : { webContents: { mainFrame } },
  };
  runInNewContext(source, sandbox);
  return sandbox.executeAcrossSellerFrames;
}

const hangForever = () => new Promise(() => {});

test("a hung seller frame is skipped after the deadline instead of freezing capture", async () => {
  const execute = loadExecutor({ subframes: [{ routingId: 2, executeJavaScript: hangForever }] });
  const started = Date.now();
  const result = await execute("return { found: true };");
  assert.ok(Date.now() - started < 10_000, "must not wait out the production deadline");
  assert.equal(result?.found, false);
});

test("a later responsive frame still wins when an earlier frame hangs", async () => {
  const answer = { found: true, label: "일주일 전" };
  const execute = loadExecutor({
    subframes: [
      { routingId: 2, executeJavaScript: hangForever },
      { routingId: 3, executeJavaScript: async () => answer },
    ],
  });
  const started = Date.now();
  const result = await execute("return { found: true };");
  assert.ok(Date.now() - started < 10_000, "must not wait out the production deadline");
  assert.deepEqual(result, answer);
});

test("a destroyed seller window reports not found so the caller fails cleanly", async () => {
  const execute = loadExecutor({ destroyWindow: true });
  assert.equal((await execute("return { found: true };"))?.found, false);
});

test("the production deadline stays bounded and every frame races it", () => {
  assert.match(main, /const SELLER_FRAME_SCRIPT_TIMEOUT_MS = 20_000/);
  const start = main.indexOf("async function executeAcrossSellerFrames(script) {");
  const end = main.indexOf("async function dragSellerScrollbarToRatio", start);
  const fn = main.slice(start, end);
  assert.match(fn, /Promise\.race\(/);
  assert.match(fn, /SELLER_FRAME_SCRIPT_TIMEOUT_MS/);
  assert.match(fn, /__sellerFrameTimeout/);
});
