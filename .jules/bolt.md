# Bolt's Journal - Critical Learnings

## 2025-02-13 - Fast Word Boundary & Character Code Fuzzy Matching
**Learning:** In hot search/filtering loops like `fuzzyMatch`, instantiating or executing RegExp literals (e.g. `/[\s\-_./:]/`) and string character indexing (`text[i]`) inside loop iterations creates significant CPU overhead and dynamic regex calls. Switching to integer `charCodeAt` comparisons, caching target query character codes, hoisting regexes, and using a lookup table (`Uint8Array(128)`) for ASCII word boundaries reduced search time by ~72% (~3.6x speedup).
**Action:** Always prefer precomputed lookup tables or integer `charCodeAt` comparisons in hot text search/match loops. Pre-lowercase tokens/text once before looping over items rather than lowercasing within inner token matching loops.
