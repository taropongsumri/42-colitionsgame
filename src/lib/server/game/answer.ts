import type { Question } from '../../shared/types';

/** NFKC + trim + lowercase, so full-width and mixed-case answers match too. */
export function normalizeAnswer(value: string): string {
	return value.normalize('NFKC').trim().toLowerCase();
}

export function isCorrectAnswer(input: string, question: Question): boolean {
	const answer = normalizeAnswer(input);
	return question.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === answer);
}
