## 2026-03-31 - Fast-Path ASCII Check in `visibleWidth` Post-ANSI Stripping

**Learning:** `visibleWidth` in `packages/tui/src/utils.ts` is called heavily across rendering, wrapping, and terminal UI layout calculations. Even after stripping ANSI codes and expanding tabs, it previously fell back to `segmenter.segment(clean)` grapheme iteration for non-ASCII cached misses. Adding an `isPrintableAscii(clean)` fast-path check post-normalization/stripping speeds up calculation by ~38x (e.g. 1.25s down to ~33ms for 20k styled lines) without altering width behavior.
**Action:** When calculating string column width after stripping escape sequences or normalizing whitespace, check if the string reduces to pure printable ASCII (`code >= 0x20 && code <= 0x7e`) before running `Intl.Segmenter` loops.
