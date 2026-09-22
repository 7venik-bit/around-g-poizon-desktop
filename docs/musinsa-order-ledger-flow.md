# Musinsa order-detail ledger flow

The ledger entry path is saved-session/automatic login → My → the observed order-history control → a user-selected order detail → capture/review → an explicit Google ledger write.

Order-list and catalog pages cannot authorize a ledger write. The main process binds each capture to its order number, purchase date and product link; changing those fields requires a new capture. A failed write can be retried with its saved order evidence. Older failed entries without evidence must be captured again.

Capture keeps separate order lines for different options of the same product. Image/title links within one line do not create duplicate rows. It reads labeled item payment and quantity, leaves missing values for review, ignores cancellation/refund lines and recommendations, and never substitutes a catalog product ID for a brand article code. If needed, a separate bounded product-page read supplies the labeled article code and a missing product photo; catalog price and stock do not replace order evidence. No buyer address or login fields are returned.

Authentication or access restrictions stop the flow. Opening the ledger does not select an order or write to Google. Original-workbook editing/export operations are unchanged.

Product-linked order thumbnails take precedence over brand logos. Lazy image attributes and responsive source sets are supported, and placeholders or temporary image URLs remain missing. Catalog photo supplementation uses metadata on the matching product page, never recommendation cards, and never overwrites an existing order photo. Missing photos require review before recording. Captured cards, the selected product, and saved ledger history show product photos; load errors are visible.

The Google bridge now puts a literal HTTPS `IMAGE(url,1)` formula into column H (사진) of newly appended purchase rows and checks the stored formula. This uses Google's [cell-fit image mode](https://support.google.com/docs/answer/3093333?hl=en); a saved formula does not prove the remote image loaded. Existing duplicate rows and unrelated cells are not modified. The desktop workbook viewer displays recognized literal IMAGE formulas and legacy photo URLs without evaluating arbitrary spreadsheet expressions or altering cached workbook/export bytes.

Deployment requires updating the existing Apps Script web-app deployment with `services/google-ledger-apps-script.gs`, retaining its existing script properties and deployment URL. Releasing the desktop app alone does not update that server script. The bridge advertises `purchase.image.v1`; if the old server records only a URL, the app explicitly reports that the Google connection must be updated for in-cell photos. Do not report the photos as deployed until this has been done and a user-selected order has been verified.

Verification uses synthetic DOM cases and isolated offline Electron pages, including an expired-session login, My/history navigation, two options of one product, product-code/photo supplementation and an explicit mocked Google write. Bridge tests check photo placement, injection rejection and duplicate preservation. The Electron fixture has its own temporary profile and intercepts HTTPS requests; it never uses real credentials, order data or a Google webhook.

Live merchant verification is still required before declaring support for the current Musinsa order-page layout. In the implementation session, the computer-use tool rejected access to the installed application as not approved. Local Electron execution also failed at GPU subprocess startup in the restricted Windows environment; required GitHub Windows checks must pass before merge.
