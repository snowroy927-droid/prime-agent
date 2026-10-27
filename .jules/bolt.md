## 2025-05-15 - Optimize fuzzy matching regex in inner loop

**Learning:** In `packages/tui/src/fuzzy.ts`, regular expression tests inside `fuzzyMatch` loops incur significant overhead during fuzzy filtering operations over large item sets.
**Action:** Replace `/[\s\-_./:]/.test()` and string indexing inside tight loops with direct `charCodeAt` numerical checks against target character codes (`isWordBoundaryChar`).
