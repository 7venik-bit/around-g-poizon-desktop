# Musinsa order-detail ledger flow

The ledger entry path is saved-session/automatic login → My → the observed order-history control → a user-selected order detail → capture/review → an explicit Google ledger write.

Order-list and catalog pages cannot authorize a ledger write. The main process binds each capture to its order number, purchase date and product link; changing those fields requires a new capture. A failed write can be retried with its saved order evidence. Older failed entries without evidence must be captured again.

Capture keeps separate order lines for different options of the same product. Image/title links within one line do not create duplicate rows. It reads labeled item payment and quantity, leaves missing values for review, ignores cancellation/refund lines and recommendations, and never substitutes a catalog product ID for a brand article code. If needed, a separate bounded product-page read supplies only the labeled article code; catalog price and stock do not replace order evidence. No buyer address or login fields are returned.

Authentication or access restrictions stop the flow. Opening the ledger does not select an order or write to Google. The Google bridge and original-workbook editing/export operations are unchanged.

Verification uses synthetic DOM cases and isolated offline Electron pages, including an expired-session login, My/history navigation, two options of one product, product-code supplementation and an explicit mocked Google write. The Electron fixture has its own temporary profile and intercepts HTTPS requests; it never uses real credentials, order data or a Google webhook.

Live merchant verification is still required before declaring support for the current Musinsa order-page layout. In the implementation session, the computer-use tool rejected access to the installed application as not approved. Local Electron execution also failed at GPU subprocess startup in the restricted Windows environment; required GitHub Windows checks must pass before merge.
