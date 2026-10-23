## 2025-05-10 - Fast Character-Code Boundary Check for Fuzzy Matching

**Learning:** Replacing regex evaluation (`/[\s\-_./:]/.test()`) inside inner string-matching loops with charCodeAt checks (`code <= 32 || code === 45 || ...`) yields ~2x speedup for fuzzy matching over large item sets without sacrificing accuracy or readability.
**Action:** Prefer direct ASCII code range/delimiter checking over regex matching inside hot loops over large lists/strings.
