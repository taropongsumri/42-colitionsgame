import { getStore } from '../src/lib/server/db';
import type { Question } from '../src/lib/shared/types';

interface SourceQuestion {
	id: string;
	category: 'computer' | 'math' | 'science';
	question: string;
	answer: string;
	accepted_answers: string[];
}

const source = await Bun.file('readme/questions.json').json() as {
	questions: SourceQuestion[];
};

const questions: Question[] = source.questions.map((q) => ({
	id: q.id,
	category: q.category,
	question: q.question,
	answer: q.answer,
	acceptedAnswers: q.accepted_answers
}));

const store = await getStore();
await store.replaceQuestions(questions);
console.log(`[seed] wrote ${questions.length} questions to the content store`);
await store.close();
