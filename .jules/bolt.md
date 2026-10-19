## 2025-03-09 - RegExp evaluation in hot inner loops
**Learning:** Using `RegExp.test` or string `.match()` inside inner matching loops (e.g., word boundary checks during fuzzy string matching) causes substantial overhead due to engine calls and string allocations. Pre-lowercasing search tokens and using `charCodeAt` integer comparisons yielded a ~4.3x speedup.
**Action:** Replace `RegExp.test` in character-by-character loops with numeric `charCodeAt` checks or lookups, and hoist static regexes to module level.
