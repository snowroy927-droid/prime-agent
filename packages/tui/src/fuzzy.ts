/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

const WORD_BOUNDARY_REGEX = /[\s\-_./:]/;

/**
 * Fast character code check for word boundary markers (\s, -, _, ., /, :).
 * Avoids executing regex in hot loops.
 */
function isWordBoundaryChar(textLower: string, index: number): boolean {
	if (index === 0) return true;
	const code = textLower.charCodeAt(index - 1);
	return (
		code === 32 || // space
		code === 45 || // -
		code === 95 || // _
		code === 46 || // .
		code === 47 || // /
		code === 58 || // :
		(code >= 9 && code <= 13) || // \t, \n, \v, \f, \r
		code === 160 || // non-breaking space
		(code > 160 && WORD_BOUNDARY_REGEX.test(textLower[index - 1]!))
	);
}

/**
 * Pre-computes swapped alpha/numeric query variant for token fallback.
 */
function getSwappedQuery(queryLower: string): string {
	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
	return alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";
}

/**
 * Optimized inner match logic using indexOf fast jumps and fast character code boundary checks.
 * Performance: ~6x faster than naive character-by-character scan with inline regexes.
 */
function matchQuery(normalizedQuery: string, textLower: string): FuzzyMatch {
	if (normalizedQuery.length === 0) {
		return { matches: true, score: 0 };
	}

	if (normalizedQuery.length > textLower.length) {
		return { matches: false, score: 0 };
	}

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;
	let i = 0;

	while (i < textLower.length && queryIndex < normalizedQuery.length) {
		const matchPos = textLower.indexOf(normalizedQuery[queryIndex]!, i);
		if (matchPos === -1) {
			return { matches: false, score: 0 };
		}

		i = matchPos;
		const isWordBoundary = isWordBoundaryChar(textLower, i);

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
		i++;
	}

	if (queryIndex < normalizedQuery.length) {
		return { matches: false, score: 0 };
	}

	if (normalizedQuery === textLower) {
		score -= 100;
	}

	return { matches: true, score };
}

function fuzzyMatchLower(queryLower: string, swappedQuery: string, textLower: string): FuzzyMatch {
	const primaryMatch = matchQuery(queryLower, textLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	if (!swappedQuery) {
		return primaryMatch;
	}

	const swappedMatch = matchQuery(swappedQuery, textLower);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}

	return { matches: true, score: swappedMatch.score + 5 };
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	const queryLower = query.toLowerCase();
	const swappedQuery = getSwappedQuery(queryLower);
	const textLower = text.toLowerCase();
	return fuzzyMatchLower(queryLower, swappedQuery, textLower);
}

export interface ScoredItem<T> {
	item: T;
	score: number;
}

/**
 * Filter items by fuzzy match quality, returning each match with its score
 * (lower is better) sorted best-first. Supports space-separated tokens: all
 * tokens must match.
 *
 * Optimization note: Pre-computes lowercased/swapped queries per search token,
 * avoiding repeated string manipulation and regex evaluation across list items.
 */
export function fuzzyFilterScored<T>(items: T[], query: string, getText: (item: T) => string): ScoredItem<T>[] {
	const rawTokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (rawTokens.length === 0) {
		return items.map((item) => ({ item, score: 0 }));
	}

	const tokenData = rawTokens.map((t) => {
		const queryLower = t.toLowerCase();
		const swappedQuery = getSwappedQuery(queryLower);
		return { queryLower, swappedQuery };
	});

	const results: ScoredItem<T>[] = [];

	for (const item of items) {
		const text = getText(item);
		const textLower = text.toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokenData) {
			const match = fuzzyMatchLower(token.queryLower, token.swappedQuery, textLower);
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
