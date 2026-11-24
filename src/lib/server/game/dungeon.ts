import {
	FLOOR_COUNT,
	TOTAL_QUESTION_SLOTS,
	floorAndPlug,
	floorForRoom,
	plugForRoom,
	roomForFloorPlug
} from '../../shared/map';
import type { LiveConfig } from '../../../../config';
import { hintTableFor, realTableFor, TABLE_IDS } from '../../shared/dungeon';
import {
	HOUSE_IDS,
	type HouseId,
	type Question,
	type QuestionCategory
} from '../../shared/types';
import { liveConfig } from '../config';
import { getStore } from '../db';
import type { HouseState } from '../db/types';

/** Per-house quota. 3 houses × 30 questions = the full 90-question bank. */
export const CATEGORY_QUOTA: Record<QuestionCategory, number> = {
	network: 15,
	sport: 5,
	general: 10
};

const CATEGORIES: QuestionCategory[] = ['network', 'sport', 'general'];

function shuffle<T>(items: readonly T[]): T[] {
	const copy = [...items];
	for (let index = copy.length - 1; index > 0; index -= 1) {
		const other = Math.floor(Math.random() * (index + 1));
		[copy[index], copy[other]] = [copy[other], copy[index]];
	}
	return copy;
}

/**
 * Deal a unique, shuffled set of 30 questions to every house: 15 network,
 * 5 sport and 10 general. The deal is persisted on the house so the server
 * always answers against the same question the player was shown.
 */
export function dealAllHouses(questions: readonly Question[]): Record<HouseId, string[]> {
	const byCategory = Object.fromEntries(
		CATEGORIES.map((category) => [category, questions.filter((q) => q.category === category)])
	) as Record<QuestionCategory, Question[]>;
	const used = new Set<string>();
	const result: Record<HouseId, string[]> = { h1: [], h2: [], h3: [] };

	for (const house of HOUSE_IDS) {
		const picked: string[] = [];
		for (const category of CATEGORIES) {
			const pool = shuffle(byCategory[category].filter((question) => !used.has(question.id)));
			for (const question of pool.slice(0, CATEGORY_QUOTA[category])) {
				picked.push(question.id);
				used.add(question.id);
			}
		}
		// Small custom banks (tests, admin previews) may not match the category
		// quotas. Fill the remaining plugs from any unused question first.
		if (picked.length < TOTAL_QUESTION_SLOTS) {
			const spare = shuffle(questions.filter((question) => !used.has(question.id)));
			for (const question of spare) {
				if (picked.length >= TOTAL_QUESTION_SLOTS) break;
				picked.push(question.id);
				used.add(question.id);
			}
		}
		result[house] = shuffle(picked).slice(0, TOTAL_QUESTION_SLOTS);
	}
	return result;
}

export function dealForHouse(house: HouseId, questions: readonly Question[]): string[] {
	return dealAllHouses(questions)[house];
}

async function ensureQuestionOrder(house: HouseState, questions: readonly Question[]): Promise<boolean> {
	const valid =
		house.questionOrder?.length === TOTAL_QUESTION_SLOTS &&
		house.questionOrder.every((id) => questions.some((question) => question.id === id));
	if (valid || !questions.length) return false;
	const dealt = dealAllHouses(questions);
	let changed = false;
	for (const id of HOUSE_IDS) {
		const state = id === house.id ? house : await getStore().then((store) => store.getHouse(id));
		if (!state) continue;
		state.questionOrder = dealt[id];
		await getStore().then((store) => store.saveHouse(state));
		if (id === house.id) changed = true;
	}
	return changed;
}

export async function questionFor(houseId: HouseId, room: number): Promise<Question | null> {
	const store = await getStore();
	const [state, questions] = await Promise.all([store.getHouse(houseId), store.listQuestions()]);
	if (!state) return null;
	await ensureQuestionOrder(state, questions);
	const id = state.questionOrder[room - 1];
	return id ? questions.find((question) => question.id === id) ?? null : null;
}

/** Four pizza-slice tables. The glowing one is real; another may hide a hint. */
export function tablesFor(house: HouseId, room: number) {
	return {
		all: TABLE_IDS,
		real: realTableFor(house, room),
		hint: hintTableFor(house, room)
	};
}

export { floorAndPlug };

/** The boss whose floor is fully cleared but who has not been beaten yet. */
export function pendingBossFor(state: HouseState, config: LiveConfig) {
	const floor = floorForRoom(state.room);
	const boss = config.boss.bosses.find(
		(entry) => entry.floor === floor && !state.defeatedBosses?.includes(entry.id)
	);
	if (!boss || plugsClearedOnFloor(state, floor) < config.game.plugsPerFloor) return null;
	return boss;
}

export function houseFloor(state: HouseState): number {
	return floorForRoom(state.room);
}

export function plugsClearedOnFloor(state: HouseState, floor: number): number {
	return state.solvedRooms.filter((room) => floorForRoom(room) === floor).length;
}

export async function roomStatuses(state: HouseState) {
	const config = await liveConfig();
	const floor = Math.min(FLOOR_COUNT, houseFloor(state));
	return Array.from({ length: config.game.plugsPerFloor }, (_, index) => {
		const plug = index + 1;
		const room = roomForFloorPlug(floor, plug);
		const status = state.solvedRooms.includes(room)
			? 'solved'
			: room === state.room
				? 'open'
				: 'locked';
		return { number: plug, status };
	});
}
