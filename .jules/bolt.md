# Bolt's Journal - Critical Learnings

## 2025-02-18 - RegExp Instantiation in Hot Character Loops
**Learning:** Re-evaluating inline RegExp literals or calling RegExp `.test()` inside hot character-by-character loops (like in `fuzzyMatch`) causes severe performance degradation and GC overhead. Pre-lowercasing query tokens once per filter call and using fast ASCII character code checks (`code <= 127`) for boundary checks yields a ~2.9x speedup.
**Action:** Avoid inline RegExp testing in tight string iteration loops; use module-scoped RegExp constants and ASCII code range checks (`charCodeAt`) for character classification fast paths.
