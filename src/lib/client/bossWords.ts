/**
 * Keep the client's visible word queue aligned with the server queue.
 *
 * The server appends a fresh word after every accepted word. Copying that word
 * into the slot the player is about to type prevents the visible queue from
 * running out after the initial word pool is exhausted.
 */
export function advanceBossWords(
	words: string[],
	wordIndex: number,
	nextWord: string
): { words: string[]; wordIndex: number } {
	const index = Math.max(0, wordIndex + 1);
	const updated = [...words];
	while (updated.length <= index) updated.push('');
	if (nextWord) updated[index] = nextWord;
	return { words: updated, wordIndex: index };
}
