# Naver search-control navigation

The normal Fashion Town collector and inline price lookup now enter Shopping
home, click its observed Fashion Town menu, enter the requested code/title in
the search field and click an identified search button. The existing query
selection still prefers an article code when available. The result URL remains
diagnostic metadata; it is no longer loaded as the search operation.

Detail verification borrows the search window and clicks the observed matching
result link. Links open in that same window, retaining its session and history.
Subsequent candidates use browser Back to the captured result document. Missing
history/cards fail without replaying a constructed search or detail URL. The
caller owns the borrowed window and cancellation cleanup. The low-level verifier
retains its isolated-window option for standalone fixture callers; both shipped
search entry points explicitly supply the search window.

Naver's rate-limit/login/security states still stop traversal. A redirect after
the single product click is passed to the existing detail readiness classifier,
so the restriction remains explicit. No proxy, identity rotation, fingerprint
masking or challenge solving is introduced. These controls do not guarantee
that Naver will permit automated access.

Validation includes unit/runtime tests for one submission, unavailable menu or
button, rate-limit interruption, back navigation, missing history and retaining
the caller-owned window. Offline Electron fixtures serve real menu/form pages
and execute production input events before reading product/stock DOM. Network
responses are fixtures; this is not evidence of live Naver access being restored.
