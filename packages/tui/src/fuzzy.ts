/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

// Pre-compiled regexes for query token character class swaps and fallback word boundaries
const ALPHA_NUMERIC_REGEX = /^(?<letters>[a-z]+)(?<digits>[0-9]+)$/;
const NUMERIC_ALPHA_REGEX = /^(?<digits>[0-9]+)(?<letters>[a-z]+)$/;
const WORD_BOUNDARY_FALLBACK_REGEX = /[\s\-_./:]/;

// Fast ASCII word boundary check to avoid RegExp creation/execution inside hot loops (~3x speedup)
function isWordBoundary(char: string, code: number): boolean {
	if (code <= 127) {
		return (
			code === 32 || // ' '
			code === 45 || // '-'
			code === 95 || // '_'
			code === 46 || // '.'
			code === 47 || // '/'
			code === 58 || // ':'
			(code >= 9 && code <= 13) // whitespace (\t, \n, \v, \f, \r)
		);
	}
	return WORD_BOUNDARY_FALLBACK_REGEX.test(char);
}

interface PreparedToken {
	lower: string;
	swapped: string;
}

function prepareToken(token: string): PreparedToken {
	const lower = token.toLowerCase();
	const alphaNumericMatch = lower.match(ALPHA_NUMERIC_REGEX);
	const numericAlphaMatch = lower.match(NUMERIC_ALPHA_REGEX);
	const swapped = alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";
	return { lower, swapped };
}

function matchQueryPrepared(normalizedQuery: string, textLower: string): FuzzyMatch {
	const qLen = normalizedQuery.length;
	const tLen = textLower.length;

	if (qLen === 0) {
		return { matches: true, score: 0 };
	}

	if (qLen > tLen) {
		return { matches: false, score: 0 };
	}

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	for (let i = 0; i < tLen && queryIndex < qLen; i++) {
		// Early exit if remaining target chars are fewer than remaining query chars
		if (tLen - i < qLen - queryIndex) {
			return { matches: false, score: 0 };
		}

		if (textLower[i] === normalizedQuery[queryIndex]) {
			const prevChar = textLower[i - 1];
			const isWordBoundaryMatch =
				i === 0 || (prevChar !== undefined && isWordBoundary(prevChar, textLower.charCodeAt(i - 1)));

			// Reward consecutive matches
			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				// Penalize gaps
				if (lastMatchIndex >= 0) {
					score += (i - lastMatchIndex - 1) * 2;
				}
			}

			// Reward word boundary matches
			if (isWordBoundaryMatch) {
				score -= 10;
			}

			// Slight penalty for later matches
			score += i * 0.1;

			lastMatchIndex = i;
			queryIndex++;
		}
	}

	if (queryIndex < qLen) {
		return { matches: false, score: 0 };
	}

	if (normalizedQuery === textLower) {
		score -= 100;
	}

	return { matches: true, score };
}

function fuzzyMatchPrepared(prep: PreparedToken, textLower: string): FuzzyMatch {
	const primaryMatch = matchQueryPrepared(prep.lower, textLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	if (!prep.swapped) {
		return primaryMatch;
	}

	const swappedMatch = matchQueryPrepared(prep.swapped, textLower);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}

	return { matches: true, score: swappedMatch.score + 5 };
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	const prep = prepareToken(query);
	return fuzzyMatchPrepared(prep, text.toLowerCase());
}

export interface ScoredItem<T> {
	item: T;
	score: number;
}

/**
 * Filter items by fuzzy match quality, returning each match with its score
 * (lower is better) sorted best-first. Supports space-separated tokens: all
 * tokens must match.
 */
export function fuzzyFilterScored<T>(items: T[], query: string, getText: (item: T) => string): ScoredItem<T>[] {
	const rawTokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (rawTokens.length === 0) {
		return items.map((item) => ({ item, score: 0 }));
	}

	// Pre-process tokens once across all items rather than per item
	const prepTokens = rawTokens.map(prepareToken);
	const results: ScoredItem<T>[] = [];

	for (const item of items) {
		const text = getText(item);
		// Lowercase target string once per item rather than once per token
		const textLower = text.toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (const prep of prepTokens) {
			const match = fuzzyMatchPrepared(prep, textLower);
			if (match.matches) {
				totalScore += match.score;
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch) {
			results.push({ item, score: totalScore });
		}
	}

	results.sort((a, b) => a.score - b.score);
	return results;
}

/**
 * Filter and sort items by fuzzy match quality (best matches first).
 * Supports space-separated tokens: all tokens must match.
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	if (!query.trim()) {
		return items;
	}
	return fuzzyFilterScored(items, query, getText).map((r) => r.item);
}
