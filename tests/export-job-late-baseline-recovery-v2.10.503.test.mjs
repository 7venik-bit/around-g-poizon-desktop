import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findNewSellerExportJob,
  findRecentSellerExportJob,
} from "../services/brand-export-jobs.mjs";

test("a job leaked into a late baseline is recovered by its request timestamp", () => {
  const requestAt = new Date(2026, 7, 29, 11, 50, 30).getTime();
  const created = {
    id: "1004910730",
    startAtMs: new Date(2026, 7, 29, 11, 50, 36).getTime(),
    succeeded: true,
  };

  assert.equal(findNewSellerExportJob([created], [created], {
    notBeforeMs: requestAt,
    baselineAuthoritative: true,
  }), null);
  assert.equal(findRecentSellerExportJob([created], {
    notBeforeMs: requestAt,
    allowedClockSkewMs: 120_000,
  })?.id, "1004910730");
});

test("timestamp recovery never reconnects a previous-day export", () => {
  const requestAt = new Date(2026, 7, 29, 11, 50, 30).getTime();
  const old = {
    id: "1004865794",
    startAtMs: new Date(2026, 7, 23, 19, 42, 9).getTime(),
  };
  assert.equal(findRecentSellerExportJob([old], {
    notBeforeMs: requestAt,
    allowedClockSkewMs: 120_000,
  }), null);
});

test("live registration uses timestamp recovery after a late baseline", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /findRecentSellerExportJob\(unusedJobs/);
  assert.match(main, /elapsedMs >= 10_000/);
  assert.match(main, /notBeforeMs: exportAcknowledgedAt/);
});
