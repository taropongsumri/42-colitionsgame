import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Bun.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'coalition-gameplay-'));

const { defaults, effectiveConfig } = await import('../config');
const { getStore } = await import('../src/lib/server/db');
const { normalizeAnswer, isCorrectAnswer } = await import('../src/lib/server/game/answer');
const { assignQuestions, tablesFor, questionFor } = await import('../src/lib/server/game/dungeon');
const { bonusPercent, roomPoints, clearPlace } = await import('../src/lib/server/game/scoring');
const { startClock, timeLeftMs } = await import('../src/lib/server/game/clock');
const { control } = await import('../src/lib/server/game/control');
const { interact, submitAnswer } = await import('../src/lib/server/game/play');
const { realTableFor, hintTableFor, TABLE_IDS } = await import('../src/lib/shared/dungeon');

const questionIds = Array.from({ length: 30 }, (_, index) => `q${String(index + 1).padStart(2, '0')}`);
const questions = questionIds.map((id, index) => ({
	id,
	category: 'math' as const,
	question: `What is ${index + 1}?`,
	answer: String(index + 1),
	acceptedAnswers: [String(index + 1)],
	hint: `Hint ${index + 1}`
}));

describe('phase 2 gameplay', () => {
	beforeAll(async () => {
		const { createMachineSession, assignHouse, acceptMachine } = await import('../src/lib/server/lobby');
		const store = await getStore();
		await store.replaceQuestions(questions);
		for (const house of ['h1', 'h2', 'h3'] as const) {
			const session = await createMachineSession();
			await assignHouse(session.code, house);
			await acceptMachine(session.code);
		}
	});

	test('answer normalization ignores case, whitespace and full-width forms', () => {
		expect(normalizeAnswer('  ＡＢＣ ')).toBe('abc');
		expect(isCorrectAnswer(' ｄｏｏｒ ', { ...questions[0], answer: 'door', acceptedAnswers: ['door'] })).toBe(true);
		expect(isCorrectAnswer('window', { ...questions[0], answer: 'door', acceptedAnswers: ['door'] })).toBe(false);
	});

	test('questions are distributed round-robin across houses', () => {
		const assigned = assignQuestions(questions);
		expect(assigned.h1).toHaveLength(10);
		expect(assigned.h2).toHaveLength(10);
		expect(assigned.h3).toHaveLength(10);
		expect(new Set([...assigned.h1, ...assigned.h2, ...assigned.h3]).size).toBe(30);
		expect(assigned.h1[0]).toBe('q01');
		expect(assigned.h2[0]).toBe('q02');
		expect(assigned.h3[0]).toBe('q03');
	});

	test('tables match client-side powered socket formula', () => {
		for (const house of ['h1', 'h2', 'h3'] as const) {
			for (let room = 1; room <= 10; room += 1) {
				const tables = tablesFor(house, room);
				expect(tables.real).toBe(realTableFor(house, room));
				expect(tables.hint).toBe(hintTableFor(house, room));
				expect(tables.real).not.toBe(tables.hint);
			}
		}
		expect(realTableFor('h1', 1)).toBe('f1-r1');
		expect(realTableFor('h1', 6)).toBe('f2-r1');
		expect(hintTableFor('h1', 5)).toBe('f1-r1');
	});

	test('scoring rewards earlier clears', () => {
		expect(bonusPercent(1, defaults)).toBe(50);
		expect(roomPoints(1, defaults)).toBe(150);
		expect(roomPoints(2, defaults)).toBe(120);
		expect(roomPoints(3, defaults)).toBe(100);

		const config = effectiveConfig({ scoring: { roomPoints: 200 } });
		expect(roomPoints(1, config)).toBe(300);
	});

	test('clear place considers progress then timestamp', () => {
		const now = 1_000_000;
		const houses = [
			{ id: 'h1' as const, solvedRooms: [1], lastClearAt: now - 100 },
			{ id: 'h2' as const, solvedRooms: [1], lastClearAt: now - 50 },
			{ id: 'h3' as const, solvedRooms: [1, 2], lastClearAt: now - 200 }
		] as never;
		expect(clearPlace('h1', now, houses)).toBe(2);
		expect(clearPlace('h2', now, houses)).toBe(2);
		expect(clearPlace('h3', now, houses)).toBe(1);
	});

	test('wrong answer locks terminal and correct answer advances progress', async () => {
		const store = await getStore();
		const house = await store.getHouse('h1');
		expect(house).not.toBeNull();
		house!.room = 1;
		house!.solvedRooms = [];
		house!.answerLockUntil = null;
		await store.saveHouse(house!);

		const question = await questionFor('h1', 1);
		expect(question).not.toBeNull();

		const currentTable = tablesFor('h1', 1).real;
		const otherTable = TABLE_IDS.find((id) => id !== currentTable)!;
		expect(currentTable).toBe('f1-r1');
		const wrongTable = interact('h1', otherTable);
		expect((await wrongTable).messages[0]).toMatchObject({ type: 'notice' });

		const asked = await interact('h1', tablesFor('h1', 1).real);
		expect(asked.messages[0]).toMatchObject({ type: 'question', room: 1, prompt: question!.question });

		const wrong = await submitAnswer('h1', 'definitely-wrong');
		expect(wrong.messages[0]).toMatchObject({ type: 'answerResult', correct: false });
		expect((await store.getHouse('h1'))!.answerLockUntil).toBeGreaterThan(Date.now());

		const locked = await submitAnswer('h1', question!.answer);
		expect(locked.messages[0]).toMatchObject({ type: 'answerResult', correct: false });
		expect((await store.getHouse('h1'))!.room).toBe(1);

		const waiting = await store.getHouse('h1');
		waiting!.answerLockUntil = null;
		await store.saveHouse(waiting!);

		const advanced = await submitAnswer('h1', question!.answer);
		expect(advanced.messages[0]).toMatchObject({ type: 'answerResult', correct: true });
		expect(advanced.messages).toContainEqual({ type: 'state', state: expect.objectContaining({ id: 'h1', room: 2 }) });
		const done = (await store.getHouse('h1'))!;
		expect(done.room).toBe(2);
		expect(done.solvedRooms).toEqual([1]);
		expect(done.score).toBeGreaterThanOrEqual(100);
		expect(done.lastClearAt).not.toBeNull();
	});

	test('admin clock and force unlock controls mutate state', async () => {
		const store = await getStore();
		const before = await store.getHouse('h1');
		before!.answerLockUntil = null;
		before!.room = 1;
		before!.solvedRooms = [];
		before!.score = 0;
		await store.saveHouse(before!);

		await control({ action: 'start' });
		const started = await timeLeftMs();
		expect(started).toBeGreaterThan(0);
		await control({ action: 'pause' });
		const paused = await timeLeftMs();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await timeLeftMs()).toBe(paused);
		await control({ action: 'resume' });

		await control({ action: 'addTime', minutes: 3 });
		expect(await timeLeftMs()).toBeGreaterThan(paused + 2 * 60 * 1000);

		await control({ action: 'adjustScore', house: 'h1', amount: 25, reason: 'test' });
		expect((await store.getHouse('h1'))!.score).toBe(25);

		await control({ action: 'forceUnlock', house: 'h1' });
		const unlocked = (await store.getHouse('h1'))!;
		expect(unlocked.solvedRooms).toContain(1);
		expect(unlocked.room).toBe(2);

		await control({ action: 'announce', text: 'hello players' });
		expect((await store.getMeta()).announcement).toBe('hello players');
		await control({ action: 'end' });
		expect((await store.getMeta()).finished).toBe(true);

		const meta = await startClock();
		expect(meta.finished).toBe(false);
	});
});
