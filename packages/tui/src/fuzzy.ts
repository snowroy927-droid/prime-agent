/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

// Fast character code check for word boundaries instead of running a regex test on every match
function isWordBoundaryCode(code: number): boolean {
	return (
		code <= 32 || // space, tab, newline, control chars
		code === 45 || // -
		code === 46 || // .
		code === 47 || // /
		code === 58 || // :
		code === 95 || // _
		(code > 127 && /\s/.test(String.fromCharCode(code))) // non-ASCII whitespace
	);
}

/**
 * Perform fuzzy matching between a query and text.
 * Optional pre-lowercased strings can be passed to avoid repeated lowercasing in batch filtering.
 */
export function fuzzyMatch(
	query: string,
	text: string,
	queryLower: string = query.toLowerCase(),
	textLower: string = text.toLowerCase(),
): FuzzyMatch {
	const matchQuery = (normalizedQuery: string): FuzzyMatch => {
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

		// Optimization: Use charCodeAt comparisons and fast word boundary checks in hot loop
		for (let i = 0; i < tLen && queryIndex < qLen; i++) {
			if (textLower.charCodeAt(i) === normalizedQuery.charCodeAt(queryIndex)) {
				const isWordBoundary = i === 0 || isWordBoundaryCode(textLower.charCodeAt(i - 1));

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

		if (normalizedQuery === textLower) {
			score -= 100;
		}

		return { matches: true, score };
	};

	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
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

	// Optimization: Pre-lowercase tokens once instead of per-item
	const lowerTokens = tokens.map((t) => t.toLowerCase());
	const results: ScoredItem<T>[] = [];

	for (const item of items) {
		const text = getText(item);
		// Optimization: Pre-lowercase item text once per item
		const textLower = text.toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (let i = 0; i < tokens.length; i++) {
			const match = fuzzyMatch(tokens[i]!, text, lowerTokens[i]!, textLower);
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
