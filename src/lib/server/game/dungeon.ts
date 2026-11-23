import { hintTableFor, realTableFor, TABLE_IDS } from '../../shared/dungeon';
import { HOUSE_IDS, type HouseId, type Question } from '../../shared/types';
import { liveConfig } from '../config';
import { getStore } from '../db';
import type { HouseState } from '../db/types';

/** Each house gets a different question in every room; all 30 questions are used. */
export function assignQuestions(questions: readonly Question[]): Record<HouseId, string[]> {
	const sorted = [...questions].sort((a, b) => a.id.localeCompare(b.id));
	const result: Record<HouseId, string[]> = { h1: [], h2: [], h3: [] };
	sorted.forEach((question, index) => {
		result[HOUSE_IDS[index % HOUSE_IDS.length]].push(question.id);
	});
	return result;
}

export async function questionFor(house: HouseId, room: number): Promise<Question | null> {
	const store = await getStore();
	const questions = await store.listQuestions();
	const id = assignQuestions(questions)[house][room - 1];
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

export async function roomStatuses(state: HouseState) {
	const { game } = await liveConfig();
	return Array.from({ length: game.roomCount }, (_, index) => {
		const number = index + 1;
		const status = state.solvedRooms.includes(number)
			? 'solved'
			: number === state.room
				? 'open'
				: 'locked';
		return { number, status };
	});
}
