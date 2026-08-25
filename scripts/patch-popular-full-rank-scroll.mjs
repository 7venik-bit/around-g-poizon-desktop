// Keep this workflow hook for compatibility, but restore the historically
// working popular-list implementation instead of replacing its table scope or
// scroll collector.
await import("./patch-popular-rankboard-scope.mjs");
console.log("known-good popular list capture preserved; no full-scroll rewrite applied");
