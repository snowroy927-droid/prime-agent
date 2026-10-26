## 2026-03-31 - Fast-Path ASCII Single-Grapheme Column Widths in TUI

**Learning:** `graphemeWidth` is invoked millions of times during text layout, truncation, and differential terminal rendering. Bypassing regex evaluation (`zeroWidthRegex`) and complex codepoint lookups for printable single-byte ASCII characters (`0x20..0x7e`) yields a ~17x speedup (~1.18s to ~68ms for 100k sentence evaluations) on common string content without changing width behavior.
**Action:** When measuring grapheme cluster or character terminal widths, always check for single ASCII printable characters first before running regexes or complex Unicode property lookups.
