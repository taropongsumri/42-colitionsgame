import { TOTAL_QUESTION_SLOTS, floorAndPlug, floorForRoom, plugForRoom } from '../../shared/map';
import { realTableFor } from '../../shared/dungeon';
import type { ServerMessage } from '../../shared/protocol';
import type { HouseId } from '../../shared/types';
import { audit } from '../audit';
import { liveConfig } from '../config';
import { getStore } from '../db';
import { isCorrectAnswer } from './answer';
import { pendingBossFor, questionFor, roomStatuses, tablesFor } from './dungeon';
import { clearPlace, roomPoints } from './scoring';

export interface PlayResult {
	messages: ServerMessage[];
	notice?: string;
	progressChanged?: boolean;
}

const error = (code: string, message: string): ServerMessage => ({ type: 'error', code, message });

export async function interact(house: HouseId, tableId: string): Promise<PlayResult> {
	const store = await getStore();
	const state = await store.getHouse(house);
	if (!state) return { messages: [error('NO_HOUSE', 'House state missing')] };

	const config = await liveConfig();
	if (state.status === 'boss' || pendingBossFor(state, config)) {
		return {
			messages: [{ type: 'notice', text: 'Boss gate open · take the lift before continuing.' }]
		};
	}

	const question = await questionFor(house, state.room);
	if (!question) {
		return { messages: [{ type: 'notice', text: 'Floor cleared — the boss awaits.' }] };
	}

	const tables = tablesFor(house, state.room);
	if (tableId === tables.hint) {
		return {
			messages: [
				{ type: 'notice', text: question.hint ? `Hint: ${question.hint}` : 'No hint here.' }
			]
		};
	}
	if (tableId !== tables.real) {
		return { messages: [{ type: 'notice', text: 'That socket has no power.' }] };
	}

	const { floor, plug } = floorAndPlug(state.room);
	return {
		messages: [
			{
				type: 'question',
				room: state.room,
				floor,
				plug,
				plugId: tables.real,
				prompt: question.question,
				hint: null
			}
		]
	};
}

export async function submitAnswer(house: HouseId, answer: string): Promise<PlayResult> {
	const store = await getStore();
	const state = await store.getHouse(house);
	if (!state) return { messages: [error('NO_HOUSE', 'House state missing')] };

	const config = await liveConfig();
	if (state.status === 'boss' || pendingBossFor(state, config)) {
		return {
			messages: [{ type: 'notice', text: 'Clear the floor boss before answering more plugs.' }]
		};
	}

	const now = Date.now();
	if (state.answerLockUntil && state.answerLockUntil > now) {
		return {
			messages: [
				{ type: 'answerResult', correct: false, lockUntil: state.answerLockUntil }
			]
		};
	}

	const question = await questionFor(house, state.room);
	if (!question) {
		return { messages: [{ type: 'notice', text: 'No question in this plug.' }] };
	}

	if (!isCorrectAnswer(answer, question)) {
		const lockUntil = now + config.game.wrongAnswerLockSeconds * 1000;
		state.answerLockUntil = lockUntil;
		await store.saveHouse(state);
		await audit({
			type: 'answer.wrong',
			house,
			message: `Wrong answer on floor ${floorForRoom(state.room)} plug ${plugForRoom(state.room)}`,
			data: { questionId: question.id }
		});
		return { messages: [{ type: 'answerResult', correct: false, lockUntil }] };
	}

	const houses = await store.listHouses();
	const place = clearPlace(house, now, houses);
	const points = roomPoints(place, config);
	const clearedFloor = floorForRoom(state.room);
	const clearedPlug = plugForRoom(state.room);
	// Only clearing the sixth plug opens the lift. Earlier plugs simply advance.
	const bossPending =
		clearedPlug === config.game.plugsPerFloor &&
		config.boss.bosses.some(
			(boss) => boss.floor === clearedFloor && !state.defeatedBosses.includes(boss.id)
		);

	// The last plug on a floor opens the lift instead of advancing to the next
	// floor. The boss win handler moves the house onto the next plug.
	state.solvedRooms.push(state.room);
	if (!bossPending) state.room = state.room + 1;
	state.status = bossPending ? 'boss' : state.room > TOTAL_QUESTION_SLOTS ? 'solved' : 'open';
	state.score += points;
	state.lastClearAt = now;
	state.answerLockUntil = null;
	await store.saveHouse(state);

	await audit(
		{
			type: 'answer.correct',
			house,
			message: `Floor ${clearedFloor} plug ${clearedPlug} cleared (+${points})`,
			data: { questionId: question.id, place, points }
		},
		'room.cleared',
		{ text: `${house} cleared floor ${clearedFloor} plug ${clearedPlug}` }
	);

	const ordinal = ['1st', '2nd', '3rd'][place - 1] ?? `${place}th`;
	const nextPlugId =
		!bossPending && state.room <= TOTAL_QUESTION_SLOTS
			? realTableFor(house, state.room)
			: null;
	return {
		messages: [
			{ type: 'answerResult', correct: true, lockUntil: null, ...(nextPlugId ? { nextPlugId } : {}) },
			{ type: 'state', state },
			{ type: 'dungeon', current: state.room, ...floorAndPlug(state.room), rooms: await roomStatuses(state) },
			{
				type: 'notice',
				text: bossPending
					? `Floor ${clearedFloor} cleared! Boss gate opened · +${points} points.`
					: `${ordinal} to clear! +${points} points.`
			}
		],
		notice: `${house} cleared floor ${clearedFloor} (${ordinal})`,
		progressChanged: true
	};
}
