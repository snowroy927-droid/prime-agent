/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

const ALPHA_NUMERIC_REGEX = /^(?<letters>[a-z]+)(?<digits>[0-9]+)$/;
const NUMERIC_ALPHA_REGEX = /^(?<digits>[0-9]+)(?<letters>[a-z]+)$/;

/** Fast check for word boundary characters (\s, -, _, ., /, :) without RegExp overhead. */
function isWordBoundaryCode(code: number): boolean {
	return (
		code <= 32 || // Whitespace
		code === 45 || // -
		code === 95 || // _
		code === 46 || // .
		code === 47 || // /
		code === 58 // :
	);
}

export function fuzzyMatch(query: string, text: string, textLower?: string): FuzzyMatch {
	const queryLower = query.toLowerCase();
	const tLower = textLower ?? text.toLowerCase();

	const matchQuery = (normalizedQuery: string): FuzzyMatch => {
		const qLen = normalizedQuery.length;
		const tLen = tLower.length;

		if (qLen === 0) {
			return { matches: true, score: 0 };
		}

		if (qLen > tLen) {
			return { matches: false, score: 0 };
		}

		// Fast availability & sequence pre-check to reject non-matching candidate strings early
		let firstIdx = -1;
		for (let k = 0; k < qLen; k++) {
			const idx = tLower.indexOf(normalizedQuery[k]!, k === 0 ? 0 : firstIdx + 1);
			if (idx === -1) {
				return { matches: false, score: 0 };
			}
			if (k === 0) {
				firstIdx = idx;
			}
		}

		let queryIndex = 0;
		let score = 0;
		let lastMatchIndex = -1;
		let consecutiveMatches = 0;

		for (let i = firstIdx; i < tLen && queryIndex < qLen; i++) {
			if (tLower[i] === normalizedQuery[queryIndex]) {
				const isWordBoundary = i === 0 || isWordBoundaryCode(tLower.charCodeAt(i - 1));

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
				if (isWordBoundary) {
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

		if (normalizedQuery === tLower) {
			score -= 100;
		}

		return { matches: true, score };
	};

	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	const alphaNumericMatch = queryLower.match(ALPHA_NUMERIC_REGEX);
	const numericAlphaMatch = queryLower.match(NUMERIC_ALPHA_REGEX);
	const swappedQuery = alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";

	if (!swappedQuery) {
		return primaryMatch;
	}

	const swappedMatch = matchQuery(swappedQuery);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}

	return { matches: true, score: swappedMatch.score + 5 };
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
	const tokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items.map((item) => ({ item, score: 0 }));
	}

	const results: ScoredItem<T>[] = [];

	for (const item of items) {
		const text = getText(item);
		// Pre-lowercase text once per item to avoid repeated allocations across tokens
		const textLower = text.toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokens) {
			const match = fuzzyMatch(token, text, textLower);
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
