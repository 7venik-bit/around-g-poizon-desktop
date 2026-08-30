# Approved otter loading modal contract

The domestic product-search loader must use the approved otter character raster.
The raster bytes are hash-pinned by the patch and verification scripts and must
not be redrawn, filtered, or regenerated.

Motion rules:
- the unchanged otter raster moves only with a slow, subtle vertical typing rhythm;
- rotation and horizontal movement are forbidden because they make the body, laptop, and shadow rock unnaturally;
- vertical movement stays within 2px and the two keyboard highlights alternate every 0.56 seconds;
- reduced-motion mode disables both stage movement and keyboard highlights.

Progress rules:
- progress starts empty at 0%;
- the native progress value equals the displayed completed/total percentage;
- the blue fill grows from left to right and reaches the end only at 100%.

Modal rules:
- the overlay covers the entire application viewport and locks background scroll;
- the search engine continues in the background while the overlay blocks UI interaction;
- elapsed time, completed/total count, percentage, progress bar, and current product number remain visible;
- the search-stop control remains available.
