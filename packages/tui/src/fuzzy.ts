/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

// Fast word boundary check for ASCII characters, falling back to regex for non-ASCII
const WORD_BOUNDARY_REGEX = /[\s\-_./:]/;
const IS_WORD_BOUNDARY_ASCII = new Uint8Array(128);
// Whitespace (\t, \n, \v, \f, \r, space) and boundary punctuation (-, ., /, :, _)
for (const ch of [9, 10, 11, 12, 13, 32, 45, 46, 47, 58, 95]) {
	IS_WORD_BOUNDARY_ASCII[ch] = 1;
}

function isWordBoundary(textLower: string, index: number): boolean {
	if (index === 0) return true;
	const prevCode = textLower.charCodeAt(index - 1);
	if (prevCode < 128) return IS_WORD_BOUNDARY_ASCII[prevCode] === 1;
	return WORD_BOUNDARY_REGEX.test(textLower[index - 1]!);
}

const ALPHA_NUMERIC_REGEX = /^([a-z]+)([0-9]+)$/;
const NUMERIC_ALPHA_REGEX = /^([0-9]+)([a-z]+)$/;

function matchQuery(queryLower: string, textLower: string): FuzzyMatch {
	const queryLen = queryLower.length;
	const textLen = textLower.length;

	if (queryLen === 0) {
		return { matches: true, score: 0 };
	}

	if (queryLen > textLen) {
		return { matches: false, score: 0 };
	}

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;
	let targetCode = queryLower.charCodeAt(0);

	// Integer character comparison loop with cached target code
	for (let i = 0; i < textLen; i++) {
		if (textLower.charCodeAt(i) === targetCode) {
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
			if (isWordBoundary(textLower, i)) {
				score -= 10;
			}

			// Slight penalty for later matches
			score += i * 0.1;

			lastMatchIndex = i;
			queryIndex++;
			if (queryIndex === queryLen) {
				break;
			}
			targetCode = queryLower.charCodeAt(queryIndex);
		}
	}

	if (queryIndex < queryLen) {
		return { matches: false, score: 0 };
	}

	if (queryLower === textLower) {
		score -= 100;
	}

	return { matches: true, score };
}

function fuzzyMatchInternal(queryLower: string, textLower: string): FuzzyMatch {
	const primaryMatch = matchQuery(queryLower, textLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	let swappedQuery = "";
	const alphaNumericMatch = queryLower.match(ALPHA_NUMERIC_REGEX);
	if (alphaNumericMatch) {
		swappedQuery = `${alphaNumericMatch[2]}${alphaNumericMatch[1]}`;
	} else {
		const numericAlphaMatch = queryLower.match(NUMERIC_ALPHA_REGEX);
		if (numericAlphaMatch) {
			swappedQuery = `${numericAlphaMatch[2]}${numericAlphaMatch[1]}`;
		}
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
	return fuzzyMatchInternal(query.toLowerCase(), text.toLowerCase());
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
	// Pre-lowercase query tokens once
	const tokens = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items.map((item) => ({ item, score: 0 }));
	}

	const results: ScoredItem<T>[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		// Lowercase item text once per item instead of per token
		const textLower = getText(item).toLowerCase();
		let totalScore = 0;
		let allMatch = true;

		for (let j = 0; j < tokens.length; j++) {
			const match = fuzzyMatchInternal(tokens[j]!, textLower);
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
