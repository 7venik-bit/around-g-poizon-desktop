# POIZON review release regression correction

The requested workflow now separates local downloaded-file synchronization from explicit POIZON verification. Release-only tests must assert that synchronization never starts Seller Center capture or writes workbook data. Paging completeness, identity validation, read-only review and final-batch notification checks remain mandatory.
