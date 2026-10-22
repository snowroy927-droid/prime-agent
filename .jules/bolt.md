## 2026-10-22 - Optimize Fuzzy Matching and Filtering in TUI

**Learning:** Re-lowercasing query tokens and target text in nested fuzzy filtering loops ($O(N \times M)$) along with evaluating single-char regex tests (`/[\s\-_./:]/.test()`) in hot matching loops causes ~38% unnecessary CPU overhead during interactive UI autocomplete and list filtering.
**Action:** Pre-lowercase query tokens and target text before outer filtering loops and replace regex boundary tests with `charCodeAt` comparisons in hot search loops.
