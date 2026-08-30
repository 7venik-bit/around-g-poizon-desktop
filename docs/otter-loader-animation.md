# Approved otter loading modal contract

The domestic product-search loader must use the approved otter character raster.
The character image is hash-pinned by the patch and verification scripts and must
not be redrawn, filtered, transformed, or animated directly.

Motion rules:
- only the two keyboard activity highlights alternate;
- the approved otter image itself stays completely still and unchanged;
- reduced-motion mode disables the keyboard highlights.

Modal rules:
- the overlay covers the entire application viewport and locks background scroll;
- the search engine continues in the background while the overlay blocks UI interaction;
- elapsed time, completed/total count, percentage, progress bar, and current product number remain visible;
- the search-stop control remains available.
