import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Question } from '../src/lib/shared/types';

Bun.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'coalition-phase5-'));

const source = (await Bun.file(new URL('../readme/questions.json', import.meta.url)).json()) as {
	questions: (Omit<Question, 'acceptedAnswers'> & { accepted_answers: string[] })[];
};
const bank: Question[] = source.questions.map((question) => ({
	id: question.id,
	category: question.category,
	question: question.question,
	answer: question.answer,
	acceptedAnswers: question.accepted_answers,
	hint: question.hint
}));

const { defaults } = await import('../config');
const {
	FLOOR_COUNT,
	QUESTIONS_PER_FLOOR,
	TOTAL_QUESTION_SLOTS,
	floorAndPlug,
	floorForRoom,
	plugForRoom,
	questionTableIdForRoom,
	roomForFloorPlug
} = await import('../src/lib/shared/map');
const { clientMessageSchema, serverMessageSchema } = await import('../src/lib/shared/protocol');
const { getStore } = await import('../src/lib/server/db');
const { liveConfig } = await import('../src/lib/server/config');
const { control } = await import('../src/lib/server/game/control');
const { dealAllHouses, questionFor } = await import('../src/lib/server/game/dungeon');
const { submitAnswer } = await import('../src/lib/server/game/play');
const { bossList, bossTick, enterBoss, findBoss, submitBossWord } = await import(
	'../src/lib/server/game/boss'
);

beforeAll(async () => {
	const { createMachineSession, assignHouse, acceptMachine } = await import('../src/lib/server/lobby');
	for (const house of ['h1', 'h2', 'h3'] as const) {
		const session = await createMachineSession();
		await assignHouse(session.code, house);
		await acceptMachine(session.code);
	}
});

describe('phase 5 floor model', () => {
	test('config and map describe five floors of six plugs', () => {
		expect(defaults.game.floorCount).toBe(5);
		expect(defaults.game.plugsPerFloor).toBe(6);
		expect(defaults.game.bossRetryDelaySeconds).toBe(120);
		expect(defaults.boss.bosses).toHaveLength(5);
		expect(defaults.boss.bosses.map((boss) => boss.floor)).toEqual([1, 2, 3, 4, 5]);
		expect(FLOOR_COUNT).toBe(5);
		expect(QUESTIONS_PER_FLOOR).toBe(6);
		expect(TOTAL_QUESTION_SLOTS).toBe(30);
		expect(roomForFloorPlug(1, 1)).toBe(1);
		expect(roomForFloorPlug(1, 6)).toBe(6);
		expect(roomForFloorPlug(2, 1)).toBe(7);
		expect(questionTableIdForRoom(6)).toBe('f1-r6');
		expect(questionTableIdForRoom(7)).toBe('f2-r1');
		for (let room = 1; room <= TOTAL_QUESTION_SLOTS; room += 1) {
			expect(floorAndPlug(room)).toEqual({ floor: floorForRoom(room), plug: plugForRoom(room) });
		}
	});

	test('the question bank has 90 unique questions with the right quotas', () => {
		expect(bank).toHaveLength(90);
		expect(new Set(bank.map((question) => question.id)).size).toBe(90);
		expect(new Set(bank.map((question) => question.question)).size).toBe(90);
		const counts = bank.reduce<Record<string, number>>((result, question) => {
			result[question.category] = (result[question.category] ?? 0) + 1;
			return result;
		}, {});
		expect(counts).toEqual({ network: 45, sport: 15, general: 30 });
		expect(bank.every((question) => question.acceptedAnswers.includes(question.answer))).toBe(true);
	});

	test('a deal gives every house 15 network, 5 sport and 10 general questions', () => {
		const dealt = dealAllHouses(bank);
		const byId = new Map(bank.map((question) => [question.id, question]));
		expect(new Set([...dealt.h1, ...dealt.h2, ...dealt.h3]).size).toBe(90);
		for (const ids of Object.values(dealt)) {
			expect(ids).toHaveLength(TOTAL_QUESTION_SLOTS);
			const counts = ids.reduce<Record<string, number>>((result, id) => {
				const category = byId.get(id)!.category;
				result[category] = (result[category] ?? 0) + 1;
				return result;
			}, {});
			expect(counts).toEqual({ network: 15, sport: 5, general: 10 });
		}
	});

	test('public boss messages never carry the answer field', async () => {
		const config = await liveConfig();
		const list = bossList(config) as unknown as { bosses: Record<string, unknown>[] };
		expect(JSON.stringify(list)).not.toContain('"answers"');
		expect(config.boss.bosses.every((boss) => Object.keys(boss).includes('answers'))).toBe(true);
		const publicFields = ['id', 'floor', 'name', 'title', 'question', 'hp', 'defeated'].sort();
		for (const publicBoss of list.bosses) {
			expect(Object.keys(publicBoss).sort()).toEqual(publicFields);
		}
	});

	test('spectator skins are typed but never accepted from players', () => {
		expect(
			clientMessageSchema.parse({ type: 'spectatorSkin', skin: 'water' })
		).toEqual({ type: 'spectatorSkin', skin: 'water' });
		expect(
			clientMessageSchema.safeParse({ type: 'spectatorSkin', skin: 'earth' }).success
		).toBe(false);
		const orbs = serverMessageSchema.parse({
			type: 'orbs',
			orbs: [{ id: 'orb-1', floor: 1, x: 10, y: 20, visible: true, skin: 'fire' }]
		});
		expect(orbs.type).toBe('orbs');
	});
});

describe('phase 5 progression and boss lifecycle', () => {
	test('any plug order opens the lift and a boss win unlocks the next floor for everyone', async () => {
		const store = await getStore();
		const config = await liveConfig();
		await store.replaceQuestions(bank);
		const house = (await store.getHouse('h1'))!;
		house.questionOrder = dealAllHouses(bank).h1;
		house.room = 1;
		house.solvedRooms = [];
		house.status = 'open';
		house.defeatedBosses = [];
		house.bossRetryAt = null;
		house.boss.active = false;
		house.answerLockUntil = null;
		await store.saveHouse(house);

		// Plug 6 is valid immediately: plugs have no priority order.
		const sixth = await questionFor('h1', 6);
		const sixthResult = await submitAnswer('h1', sixth!.answer, 'f1-r6');
		const afterSixth = (await store.getHouse('h1'))!;
		expect(afterSixth.room).toBe(6);
		expect(afterSixth.status).toBe('open');
		expect(afterSixth.solvedRooms).toEqual([6]);
		expect(
			sixthResult.messages.find((message) => message.type === 'answerResult')
		).toEqual({ type: 'answerResult', correct: true, lockUntil: null });

		for (const plug of [3, 1, 5, 2, 4]) {
			const question = await questionFor('h1', plug);
			await submitAnswer('h1', question!.answer, `f1-r${plug}`);
		}
		const gated = (await store.getHouse('h1'))!;
		expect(gated.status).toBe('boss');
		expect([...gated.solvedRooms].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

		// The other houses are still on floor 1 until the boss is defeated.
		const waiting = (await store.getHouse('h2'))!;
		expect(floorForRoom(waiting.room)).toBe(1);

		const entered = await enterBoss('h1', 'staff');
		expect(entered.messages.some((message) => message.type === 'boss.start')).toBe(true);
		const staff = findBoss(config, 'staff')!;
		const fighting = (await store.getHouse('h1'))!;
		fighting.boss.hp = 1;
		// A combo break pierces the chip floor, so this always finishes the fight.
		fighting.boss.wordCombo = staff.comboBreakEvery - 1;
		await store.saveHouse(fighting);
		const word = fighting.boss.wordQueue[fighting.boss.wordIndex];
		const won = await submitBossWord('h1', word);
		const advanced = (await store.getHouse('h1'))!;
		expect(advanced.boss.active).toBe(false);
		expect(advanced.room).toBe(7);
		expect(advanced.status).toBe('open');
		expect(advanced.defeatedBosses).toContain('staff');

		// Everyone moves to floor 2 together, even if they were at another plug.
		for (const id of ['h2', 'h3'] as const) {
			const sharedHouse = (await store.getHouse(id))!;
			expect(sharedHouse.room).toBe(7);
			expect(sharedHouse.status).toBe('open');
			expect(sharedHouse.defeatedBosses).toContain('staff');
			const messages = won.shared?.get(id) ?? [];
			expect(messages).toContainEqual({
				type: 'state',
				state: expect.objectContaining({ id, room: 7 })
			});
			expect(messages.some((message) => message.type === 'dungeon')).toBe(true);
		}

		const again = await enterBoss('h1', 'staff');
		expect(again.messages).toContainEqual(
			expect.objectContaining({ type: 'error', code: 'BOSS_DEFEATED' })
		);
	});

	test('knockout delays retries and every retry refills boss HP', async () => {
		const store = await getStore();
		const config = await liveConfig();
		const boss = findBoss(config, 'janitor')!;
		const house = (await store.getHouse('h2'))!;
		house.room = roomForFloorPlug(2, QUESTIONS_PER_FLOOR);
		house.solvedRooms = Array.from({ length: QUESTIONS_PER_FLOOR }, (_, index) =>
			roomForFloorPlug(2, index + 1)
		);
		house.status = 'boss';
		house.defeatedBosses = [];
		house.bossRetryAt = null;
		house.boss.active = false;
		await store.saveHouse(house);

		const entered = await enterBoss('h2', boss.id);
		const start = entered.messages.find((message) => message.type === 'boss.start')!;
		expect(start).toMatchObject({ hp: boss.hp, maxHp: boss.hp });

		const fighting = (await store.getHouse('h2'))!;
		fighting.boss.mode = 'typing';
		fighting.boss.playerHp = 1;
		fighting.boss.attackAt = 0;
		await store.saveHouse(fighting);
		const firstTick = await bossTick();
		expect(firstTick.byHouse.get('h2')?.some((message) => message.type === 'boss.stun')).toBe(true);
		const stunned = (await store.getHouse('h2'))!;
		stunned.boss.stunUntil = Date.now() - 1;
		await store.saveHouse(stunned);
		const secondTick = await bossTick();
		const ended = secondTick.byHouse.get('h2')?.find((message) => message.type === 'boss.end');
		expect(ended).toMatchObject({ won: false, reason: 'knockout' });
		const knockedOut = (await store.getHouse('h2'))!;
		expect(knockedOut.bossRetryAt).toBeGreaterThan(Date.now());
		expect(knockedOut.status).toBe('boss');

		const blocked = await enterBoss('h2', boss.id);
		expect(blocked.messages).toContainEqual(
			expect.objectContaining({ type: 'error', code: 'BOSS_RETRY' })
		);

		await control({ action: 'clearBossRetry', house: 'h2' });
		const retry = await enterBoss('h2', boss.id);
		const retryStart = retry.messages.find((message) => message.type === 'boss.start')!;
		expect(retryStart).toMatchObject({ hp: boss.hp, maxHp: boss.hp });
	});

	test('forceBoss opens the current floor lift instead of skipping floors', async () => {
		const store = await getStore();
		const house = (await store.getHouse('h3'))!;
		house.room = 8;
		house.solvedRooms = [1, 2, 3, 4, 5, 6, 7];
		house.status = 'open';
		house.bossRetryAt = null;
		await store.saveHouse(house);
		await control({ action: 'forceBoss', house: 'h3' });
		const forced = (await store.getHouse('h3'))!;
		expect(forced.room).toBe(12);
		expect(forced.status).toBe('boss');
		expect(forced.solvedRooms).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});
});
