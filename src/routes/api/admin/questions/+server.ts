import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { audit } from '$lib/server/audit';
import { getStore } from '$lib/server/db';
import type { QuestionCategory } from '$lib/shared/types';

type QuestionBody = {
	id?: string;
	question?: string;
	answer?: string;
	acceptedAnswers?: string[];
	hint?: string;
	category?: string;
};

const CATEGORIES: QuestionCategory[] = ['network', 'sport', 'general'];

function valid(body: unknown): body is QuestionBody {
	if (!body || typeof body !== 'object') return false;
	const item = body as QuestionBody;
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		item.id.length <= 64 &&
		typeof item.question === 'string' &&
		item.question.length > 0 &&
		typeof item.answer === 'string' &&
		Array.isArray(item.acceptedAnswers) &&
		(!item.category || CATEGORIES.includes(item.category as QuestionCategory))
	);
}

export const GET: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const store = await getStore();
	return json({ questions: await store.listQuestions() });
};

export const PUT: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as { questions?: unknown } | null;
	if (!body || !Array.isArray(body.questions) || !body.questions.every(valid)) {
		return json({ error: 'Invalid question bank' }, { status: 400 });
	}
	const questions = body.questions.map((item) => ({
		id: item.id!,
		question: item.question!,
		answer: item.answer!,
		acceptedAnswers: item.acceptedAnswers!,
		hint: item.hint,
		category: (item.category as QuestionCategory) ?? 'general'
	}));
	const store = await getStore();
	await store.replaceQuestions(questions);
	await audit({ type: 'admin.questions', message: `Question bank saved (${questions.length})` });
	return json({ ok: true, count: questions.length });
};
