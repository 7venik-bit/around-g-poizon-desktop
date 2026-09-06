import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Seller pagination patch target not found (${label}): ${before.slice(0, 120)}`);
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "const sellerPageDelayMs = 2_500;",
  "const sellerPageDelayMs = 7_000;",
  "page delay",
);
replaceOnce(
  "const sellerBatchPauseMs = 10_000;",
  "const sellerBatchPauseMs = 30_000;",
  "batch pause",
);
replaceOnce(
  "const sellerPageResponseAttempts = 120; // 120 × 250ms = 30 seconds",
  "const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds",
  "response wait",
);
replaceOnce(
  "서버 보호를 위해 10초 휴식 중",
  "서버 보호를 위해 30초 휴식 중",
  "progress pause message",
);
replaceOnce(
  "다음 페이지를 30초씩 재시도했지만 응답하지 않았습니다.",
  "다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다.",
  "failure wait message",
);
replaceOnce(
  "  const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds\n",
  "  const sellerPageResponseAttempts = 240; // 240 × 250ms = 60 seconds\n  const sellerPageSettleMs = 5_000;\n",
  "post-navigation settle",
);
replaceOnce(
  "    return false;\n  })()`, true);\n  const pages = [];",
  "    return false;\n  })()`, true);\n  await wait(sellerPageSettleMs);\n  const pages = [];",
  "first-page settle",
);
replaceOnce(
  "        pageCount,\n        totalCount,\n        rowSignature:",
  "        pageCount,\n        pageSize,\n        totalCount,\n        rowSignature:",
  "capture page size",
);
replaceOnce(
  "    const expectedNextPage = capture.currentPage + 1;\n    let advanced = false;",
  "    const expectedNextPage = capture.currentPage + 1;\n    const expectedNextRowCount = Number(capture.totalCount || 0) > 0 && Number(capture.pageSize || 0) > 0\n      ? expectedNextPage < Number(capture.pageCount || expectedNextPage)\n        ? Number(capture.pageSize)\n        : Math.max(1, Number(capture.totalCount) - (Number(capture.pageSize) * (Number(capture.pageCount) - 1)))\n      : 0;\n    let advanced = false;",
  "expected next-page row count",
);
replaceOnce(
  "          rowCount: nextState?.rowCount,\n          previousSignature: capture.rowSignature,",
  "          rowCount: nextState?.rowCount,\n          expectedRowCount: expectedNextRowCount,\n          previousSignature: capture.rowSignature,",
  "transition complete-row requirement",
);
replaceOnce(
  "          if (Number(active?.textContent.trim()) === expected\n            && rowSignature !== ${JSON.stringify(capture.rowSignature || \"\")}) return true;",
  "          if (Number(active?.textContent.trim()) === expected\n            && rows.length >= Math.max(1, ${expectedNextRowCount})\n            && rowSignature !== ${JSON.stringify(capture.rowSignature || \"\")}) return true;",
  "fallback complete-row requirement",
);
replaceOnce(
  "    if (!advanced) {\n      pageTransitionFailure = { page: capture.currentPage, expectedNextPage, reason: \"NEXT_PAGE_NOT_VERIFIED\" };\n      break;\n    }\n  }",
  "    if (!advanced) {\n      pageTransitionFailure = { page: capture.currentPage, expectedNextPage, reason: \"NEXT_PAGE_NOT_VERIFIED\" };\n      break;\n    }\n    await wait(sellerPageSettleMs);\n  }",
  "settle after verified navigation",
);
replaceOnce(
  "  const paginationComplete = !pageTransitionFailure\n    && lastCapturedPage >= expectedPageCount\n    && (!sellerSourceTotal || capturedRowCount >= sellerSourceTotal);\n  if (!paginationComplete) {\n    stopBrandNetworkCapture();\n    return {\n      ok: false,\n      code: \"SELLER_PAGINATION_INCOMPLETE\",\n      message: `판매자센터 하단 페이지 검증이 ${lastCapturedPage}/${expectedPageCount}페이지에서 중단되었습니다. 다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다. 부분 데이터는 저장하지 않습니다.`,\n      sourceTotal: sellerSourceTotal,\n      capturedRowCount,\n      pageTransitionFailure,\n    };\n  }",
  "  const paginationComplete = !pageTransitionFailure\n    && lastCapturedPage >= expectedPageCount;\n  const rowCountComplete = !sellerSourceTotal || capturedRowCount >= sellerSourceTotal;\n  if (!paginationComplete || !rowCountComplete) {\n    const reachedLastPage = !pageTransitionFailure && lastCapturedPage >= expectedPageCount;\n    stopBrandNetworkCapture();\n    return {\n      ok: false,\n      code: reachedLastPage ? \"SELLER_ROW_COUNT_INCOMPLETE\" : \"SELLER_PAGINATION_INCOMPLETE\",\n      message: reachedLastPage\n        ? `판매자센터 ${lastCapturedPage}/${expectedPageCount}페이지까지 모두 확인했지만 화면 상품을 ${capturedRowCount}/${sellerSourceTotal}건만 읽었습니다. 누락 행을 재확인해야 하므로 부분 데이터는 저장하지 않습니다.`\n        : `판매자센터 하단 페이지 검증이 ${lastCapturedPage}/${expectedPageCount}페이지에서 중단되었습니다. 다음 페이지를 60초씩 재시도했지만 응답하지 않았습니다. 부분 데이터는 저장하지 않습니다.`,\n      sourceTotal: sellerSourceTotal,\n      capturedRowCount,\n      pageTransitionFailure,\n    };\n  }",
  "separate last-page row completeness",
);

if (changed) {
  await writeFile(mainPath, source, "utf8");
  console.log("Applied slower Seller Center pagination pacing and full-row readiness checks.");
} else {
  console.log("Seller Center pagination pacing and full-row readiness already patched.");
}
