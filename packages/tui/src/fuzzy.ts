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
 * Fast word boundary check. Avoids running a regular expression on every
 * character in hot matching loops when the character is standard ASCII.
 */
function isWordBoundary(char: string): boolean {
	const code = char.charCodeAt(0);
	return (
		code === 0x20 || // space
		(code >= 0x09 && code <= 0x0d) || // whitespace: \t, \n, \v, \f, \r
		code === 0x2d || // -
		code === 0x5f || // _
		code === 0x2e || // .
		code === 0x2f || // /
		code === 0x3a || // :
		(code > 0x7e && WORD_BOUNDARY_REGEX.test(char))
	);
}

function matchNormalizedQuery(normalizedQuery: string, textLower: string): FuzzyMatch {
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

	for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) {
		if (textLower[i] === normalizedQuery[queryIndex]) {
			const isBoundary = i === 0 || isWordBoundary(textLower[i - 1]!);

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
			if (isBoundary) {
				score -= 10;
			}

			// Slight penalty for later matches
			score += i * 0.1;

			lastMatchIndex = i;
			queryIndex++;
		}
	}

	if (queryIndex < normalizedQuery.length) {
		return { matches: false, score: 0 };
	}

	if (normalizedQuery === textLower) {
		score -= 100;
	}

	return { matches: true, score };
}

function fuzzyMatchLowered(queryLower: string, textLower: string): FuzzyMatch {
	const primaryMatch = matchNormalizedQuery(queryLower, textLower);
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

	const swappedMatch = matchNormalizedQuery(swappedQuery, textLower);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}

	return { matches: true, score: swappedMatch.score + 5 };
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	return fuzzyMatchLowered(query.toLowerCase(), text.toLowerCase());
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
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items.map((item) => ({ item, score: 0 }));
	}

	const results: ScoredItem<T>[] = [];

	// Pre-lowercase each item once instead of re-lowercasing per token
	for (const item of items) {
		const text = getText(item);
		const textLower = text.toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokens) {
			const match = fuzzyMatchLowered(token, textLower);
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
