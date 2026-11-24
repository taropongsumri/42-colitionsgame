import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Bun.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'coalition-gameplay-'));

const { defaults, effectiveConfig } = await import('../config');
const { getStore } = await import('../src/lib/server/db');
const { normalizeAnswer, isCorrectAnswer } = await import('../src/lib/server/game/answer');
const {
	dealAllHouses,
	pendingBossFor,
	tablesFor,
	questionFor
} = await import('../src/lib/server/game/dungeon');
const { bonusPercent, roomPoints, clearPlace } = await import('../src/lib/server/game/scoring');
const { startClock, timeLeftMs } = await import('../src/lib/server/game/clock');
const { control } = await import('../src/lib/server/game/control');
const { interact, submitAnswer } = await import('../src/lib/server/game/play');
const {
	bossList,
	bossTick,
	enterBoss,
	findBoss,
	playerAttack,
	submitBossAnswer,
	submitBossWord
} = await import('../src/lib/server/game/boss');
const { liveConfig } = await import('../src/lib/server/config');
const { serverMessageSchema } = await import('../src/lib/shared/protocol');
const { realTableFor, hintTableFor, TABLE_IDS } = await import('../src/lib/shared/dungeon');
const { advanceBossWords } = await import('../src/lib/client/bossWords');

/** Mirror the production 90-question quotas for deterministic tests. */
const questions = Array.from({ length: 90 }, (_, index) => {
	const category = index < 45 ? 'network' : index < 60 ? 'sport' : 'general';
	return {
		id: `q${String(index + 1).padStart(3, '0')}`,
		category: category as 'network' | 'sport' | 'general',
		question: `What is ${index + 1}?`,
		answer: String(index + 1),
		acceptedAnswers: [String(index + 1)],
		hint: `Hint ${index + 1}`
	};
});

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

	test('questions are dealt uniquely with per-house category quotas', () => {
		const dealt = dealAllHouses(questions);
		expect(dealt.h1).toHaveLength(30);
		expect(dealt.h2).toHaveLength(30);
		expect(dealt.h3).toHaveLength(30);
		expect(new Set([...dealt.h1, ...dealt.h2, ...dealt.h3]).size).toBe(90);
		for (const ids of Object.values(dealt)) {
			const byId = new Map(questions.map((question) => [question.id, question]));
			const counts = ids.reduce<Record<string, number>>((result, id) => {
				const category = byId.get(id)!.category;
				result[category] = (result[category] ?? 0) + 1;
				return result;
			}, {});
			expect(counts).toEqual({ network: 15, sport: 5, general: 10 });
		}
	});

	test('tables match the six-plug floor map', () => {
		for (const house of ['h1', 'h2', 'h3'] as const) {
			for (let room = 1; room <= 30; room += 1) {
				const tables = tablesFor(house, room);
				expect(tables.real).toBe(realTableFor(house, room));
				expect(tables.hint).toBe(hintTableFor(house, room));
				expect(tables.real).not.toBe(tables.hint);
			}
		}
		expect(realTableFor('h1', 1)).toBe('f1-r1');
		expect(realTableFor('h1', 6)).toBe('f1-r6');
		expect(realTableFor('h1', 7)).toBe('f2-r1');
		expect(hintTableFor('h1', 6)).toBe('f1-r1');
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
		house!.status = 'open';
		house!.defeatedBosses = [];
		house!.bossRetryAt = null;
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
		expect((await store.getMeta()).open).toBe(true);
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
		expect(unlocked.status).toBe('open');

		await control({ action: 'announce', text: 'hello players' });
		expect((await store.getMeta()).announcement).toBe('hello players');
		await control({ action: 'end' });
		expect((await store.getMeta()).finished).toBe(true);
		expect((await store.getMeta()).open).toBe(false);

		const meta = await startClock();
		expect(meta.finished).toBe(false);
		expect(meta.open).toBe(true);
	});

	test('boss fight is server-authoritative and bosses can be added to config', async () => {
		const store = await getStore();
		const config = await liveConfig();
		const boss = findBoss(config, 'staff');
		expect(boss).not.toBeNull();
		expect(bossList(config)).toMatchObject({
			type: 'boss.list',
			bosses: expect.arrayContaining([expect.objectContaining({ id: 'staff' })])
		});

		const custom = effectiveConfig({
			boss: { bosses: [{ ...boss!, id: 'extra-boss', name: 'Extra Boss' }] }
		});
		expect(custom.boss.bosses).toHaveLength(1);
		expect(custom.boss.bosses[0].id).toBe('extra-boss');

		const house = (await store.getHouse('h1'))!;
		house.room = config.game.plugsPerFloor;
		house.solvedRooms = Array.from(
			{ length: config.game.plugsPerFloor },
			(_, index) => index + 1
		);
		house.defeatedBosses = [];
		house.bossRetryAt = null;
		house.boss.active = false;
		house.answerLockUntil = null;
		const scoreBefore = house.score;
		await store.saveHouse(house);

		const entered = await enterBoss('h1', 'staff');
		const start = entered.messages.find((message) => message.type === 'boss.start');
		expect(start).toMatchObject({
			type: 'boss.start',
			boss: expect.objectContaining({ id: 'staff' }),
			shieldMax: boss!.shieldMax,
			attackCost: expect.any(Number)
		});
		expect(JSON.stringify(entered.messages)).not.toContain('"answers"');
		expect(JSON.stringify(entered.messages)).not.toContain(boss!.answers[0]);

		const fighting = (await store.getHouse('h1'))!;
		const currentWord = fighting.boss.wordQueue[fighting.boss.wordIndex];
		const wrongWord = await submitBossWord('h1', 'not-in-the-queue');
		expect(wrongWord.messages[0]).toMatchObject({ type: 'boss.word', correct: false, combo: 0 });
		const rightWord = await submitBossWord('h1', currentWord);
		expect(rightWord.messages[0]).toMatchObject({ type: 'boss.word', correct: true, combo: 1 });
		expect((rightWord.messages[0] as { chip: number }).chip).toBeGreaterThan(0);

		// Consecutive words build combo and increase chip damage.
		const comboState = (await store.getHouse('h1'))!;
		const secondWord = comboState.boss.wordQueue[comboState.boss.wordIndex];
		const secondHit = await submitBossWord('h1', secondWord);
		expect(secondHit.messages[0]).toMatchObject({ type: 'boss.word', correct: true, combo: 2 });
		expect((secondHit.messages[0] as { chip: number }).chip).toBeGreaterThanOrEqual(
			(rightWord.messages[0] as { chip: number }).chip
		);

		// Client cannot choose damage: shield is spent and damage is derived server-side.
		const charged = (await store.getHouse('h1'))!;
		const thirdWord = charged.boss.wordQueue[charged.boss.wordIndex];
		await submitBossWord('h1', thirdWord);
		const shieldBefore = (await store.getHouse('h1'))!.boss.shield;
		const attack = await playerAttack('h1');
		expect(attack.messages[0]).toMatchObject({ type: 'boss.playerAttack' });
		const hit = attack.messages[0] as { damage: number; shield: number; readyAt: number; move: string };
		expect(typeof hit.move).toBe('string');
		expect(typeof hit.damage).toBe('number');
		expect(hit.damage).toBeGreaterThan(0);
		expect(hit.shield).toBe(shieldBefore - Math.max(10, Math.round(boss!.shieldMax * 0.15)));
		expect(hit.readyAt).toBeGreaterThan(Date.now());
		const cooling = await playerAttack('h1');
		expect(cooling.messages[0]).toMatchObject({ type: 'boss.playerAttack', reason: 'COOLDOWN', damage: 0 });

		const wrongAgain = await submitBossWord('h1', 'not-in-the-queue');
		expect(wrongAgain.messages[0]).toMatchObject({ type: 'boss.word', correct: false, combo: 0 });

		const wrongAnswer = await submitBossAnswer('h1', 'definitely-not-the-answer');
		expect(wrongAnswer.messages[0]).toMatchObject({ type: 'boss.answerResult', correct: false });
		const unlocked = (await store.getHouse('h1'))!;
		unlocked.boss.lockUntil = null;
		unlocked.answerLockUntil = null;
		await store.saveHouse(unlocked);

		const audition = await submitBossAnswer('h1', boss!.answers[0]);
		expect(audition.messages).toContainEqual({
			type: 'boss.audition',
			length: expect.any(Number),
			beatSeconds: expect.any(Number),
			bossHp: expect.any(Number),
			maxHp: expect.any(Number)
		});
		expect(JSON.stringify(audition.messages)).not.toContain(boss!.answers[0]);

		for (let tick = 0; tick < 40; tick += 1) {
			const state = (await store.getHouse('h1'))!;
			if (!state.boss.active) break;
			if (state.boss.audition) state.boss.audition.nextAt = 0;
			await store.saveHouse(state);
			await bossTick();
		}

		const done = (await store.getHouse('h1'))!;
		expect(done.boss.active).toBe(false);
		expect(done.score).toBeGreaterThan(scoreBefore);
	});

	test('client word queue advances past the initial boss word pool', () => {
		const initial = Array.from({ length: 24 }, (_, index) => `w${index}`);
		const first = advanceBossWords(initial, 0, 'w1');
		expect(first.wordIndex).toBe(1);
		expect(first.words[1]).toBe('w1');

		const pastPool = advanceBossWords(initial, 23, 'fresh-word');
		expect(pastPool.wordIndex).toBe(24);
		expect(pastPool.words[24]).toBe('fresh-word');
		expect(pastPool.words).toHaveLength(25);
	});

	test('combo breaks scale per tier, pierce the chip floor and can win the fight', async () => {
		const store = await getStore();
		const config = await liveConfig();
		const boss = findBoss(config, 'staff')!;
		const house = (await store.getHouse('h2'))!;
		house.room = config.game.plugsPerFloor;
		house.solvedRooms = Array.from(
			{ length: config.game.plugsPerFloor },
			(_, index) => index + 1
		);
		house.defeatedBosses = [];
		house.bossRetryAt = null;
		house.boss.active = false;
		house.answerLockUntil = null;
		await store.saveHouse(house);

		const entered = await enterBoss('h2', 'staff');
		const start = entered.messages.find((message) => message.type === 'boss.start')!;
		expect(start).toMatchObject({
			type: 'boss.start',
			comboBreakEvery: boss.comboBreakEvery,
			showNextWords: boss.showNextWords !== false
		});
		expect(serverMessageSchema.safeParse(start).success).toBe(true);

		const initial = (await store.getHouse('h2'))!;
		expect(initial.boss.wordQueue).toHaveLength(boss.wordPool.length);

		const totalWords = boss.comboBreakEvery * 3;
		let lastMessages: { messages: unknown[] } = { messages: [] };
		for (let index = 0; index < totalWords; index += 1) {
			const current = (await store.getHouse('h2'))!;
			const word = current.boss.wordQueue[current.boss.wordIndex];
			const result = await submitBossWord('h2', word);
			const message = result.messages[0] as Record<string, unknown>;
			const combo = index + 1;
			const tier = Math.floor(combo / boss.comboBreakEvery);
			const isBreak = combo % boss.comboBreakEvery === 0;

			expect(message).toMatchObject({ type: 'boss.word', correct: true, combo, finisher: isBreak });
			if (isBreak) {
				const expectedPercent = boss.comboBreakPercent + (tier - 1) * (boss.comboBreakStackPercent ?? 0);
				expect(message.finisherTier).toBe(tier);
				expect(message.finisherPercent).toBe(expectedPercent);
				expect(message.finisherDamage as number).toBeGreaterThan(0);
				expect(serverMessageSchema.safeParse(message).success).toBe(true);
			}

			const after = (await store.getHouse('h2'))!;
			expect(after.boss.wordIndex).toBe(current.boss.wordIndex + 1);
			expect(message.nextWord).toBe(after.boss.wordQueue[after.boss.wordIndex]);
			lastMessages = result;
		}

		expect(lastMessages.messages).toContainEqual(
			expect.objectContaining({ type: 'boss.end', won: true, reason: 'win' })
		);
		const done = (await store.getHouse('h2'))!;
		expect(done.boss.active).toBe(false);
		expect(done.boss.wordIndex).toBe(totalWords);
	});

	test('knockout waits for the death delay, then exits the dungeon', async () => {
		const store = await getStore();
		const config = await liveConfig();
		const house = (await store.getHouse('h3'))!;
		house.room = config.game.plugsPerFloor;
		house.solvedRooms = Array.from(
			{ length: config.game.plugsPerFloor },
			(_, index) => index + 1
		);
		house.defeatedBosses = [];
		house.bossRetryAt = null;
		house.boss.active = false;
		house.answerLockUntil = null;
		house.score = 200;
		await store.saveHouse(house);

		await enterBoss('h3', 'staff');
		const dying = (await store.getHouse('h3'))!;
		dying.boss.playerHp = 1;
		dying.boss.attackAt = 0;
		await store.saveHouse(dying);

		const attackTick = await bossTick();
		expect(attackTick.byHouse.get('h3') ?? []).toContainEqual(
			expect.objectContaining({ type: 'boss.stun' })
		);
		const stunned = (await store.getHouse('h3'))!;
		expect(stunned.boss.mode).toBe('stunned');
		expect(stunned.boss.stunUntil).toBeGreaterThan(Date.now());
		expect(stunned.score).toBeLessThan(200);

		stunned.boss.stunUntil = Date.now() - 1;
		await store.saveHouse(stunned);
		const exitTick = await bossTick();
		expect(exitTick.byHouse.get('h3') ?? []).toContainEqual(
			expect.objectContaining({ type: 'boss.end', won: false, reason: 'knockout' })
		);
		const ended = (await store.getHouse('h3'))!;
		expect(ended.boss.active).toBe(false);
		expect(ended.answerLockUntil).toBeNull();
	});
});
