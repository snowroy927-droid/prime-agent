## 2026-03-31 - Fast Character Code Lookups for Fuzzy Matching
**Learning:** In-loop regex evaluation (e.g. `/[\s\-_./:]/.test()`) and string indexing inside tight search loops cause significant JS runtime overhead. Checking ASCII character codes directly via `charCodeAt` with a fallback for Unicode (`code > 127`) eliminates regex allocations and yields a >3x speedup.
**Action:** When optimizing string matching loops or parsers, replace in-loop regex tests with fast ASCII char code range checks and hoist static regular expressions to file scope.
