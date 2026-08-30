# Approved otter loading modal contract

The domestic product-search loader must use the approved otter character raster.
The raster bytes are hash-pinned by the patch and verification scripts and must
not be redrawn, filtered, or regenerated.

Motion rules:
- the wrapper around the unchanged otter raster moves in a visible typing rhythm;
- the movement stays compact: up to 4px vertically and 0.55 degrees of rotation;
- the two keyboard activity highlights alternate with the typing rhythm;
- reduced-motion mode disables both stage movement and keyboard highlights.

Modal rules:
- the overlay covers the entire application viewport and locks background scroll;
- the search engine continues in the background while the overlay blocks UI interaction;
- elapsed time, completed/total count, percentage, progress bar, and current product number remain visible;
- the search-stop control remains available.
