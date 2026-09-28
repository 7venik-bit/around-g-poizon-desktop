# Official product price ownership

## Observed live

On 2026-09-29, browser UI inspection of
https://dk-on.com/DESCENTE/product/SR313LCR71/GRY0 showed
`크론 레이서 / GRAY`, member price 141,550 won and original price 149,000 won.
Selecting GRY0 from the BKWH page changed the heading and radio selection while
the URL remained BKWH. Purchase pricing used the nested `#prod-price` containers,
with the current amount in `.price-group` and original price in `.origin`.
The 49,000 won in the user's saved app result disagreed with this live price.
The exact historical DOM node that produced 49,000 was not recorded/verified.

## Cause and change

The direct-detail fallback scanned page-wide amounts, removed struck prices and
selected the minimum. It did not establish ownership, visibility or price type.
Later stock/detail verification retained the original card price unchanged.

The new collector accepts a visible purchase amount owned by the requested
product. DK additionally requires the model heading and selected color to match
the requested URL. Member/original prices stay separate; recommendation prices,
coupon deductions and hidden content cannot supply a missing amount.
Other official stores require identifiable product and purchase-panel evidence;
unsupported or ambiguous layouts return price 0 (displayed as `가격 확인`), not a
guessed minimum. JSON-LD alone does not confirm a displayed selling amount.

Both direct and search-card paths re-read price at detail readiness. Legacy
recovery rows with stock but no price verification must be checked again. A
later card/stock checkpoint cannot overwrite a verified price for the same URL;
an explicit new failed price observation can clear it. Existing completed saved
searches are refreshed by running product search again, without editing user data.

## Verification scope

Unit and runtime fixtures cover recommendation contamination, actual color-price
differences, unchanged URLs after color switching, missing/delayed/hidden prices,
conflicting prices, product query IDs and recovery. An offline Windows Electron
fixture executes the production serialized collector in Chromium. Automated
fixtures are not evidence of live coverage for every brand or an installed-app
end-to-end live search.
