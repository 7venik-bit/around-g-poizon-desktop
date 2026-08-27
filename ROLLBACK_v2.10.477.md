# v2.10.477 rollback checkpoint

This branch restores the application source tree to the exact v2.10.477 state.

Scope:
- remove changes introduced after v2.10.477
- restore the previous POIZON Excel preview/import behavior
- restore the previous domestic search/UI behavior from v2.10.477
- do not modify user data or downloaded Excel files

This marker exists only to make the rollback intent explicit in the PR and should be removed before merge if a byte-for-byte v2.10.477 tree is required.
