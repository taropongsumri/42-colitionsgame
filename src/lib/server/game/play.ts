import {
	floorAndPlug,
	floorForRoom,
	plugForRoom,
	questionTableIdForRoom,
	roomForTableId
} from '../../shared/map';
import type { ServerMessage } from '../../shared/protocol';
import type { HouseId } from '../../shared/types';
import { audit } from '../audit';
import { liveConfig } from '../config';
import { getStore } from '../db';
import { isCorrectAnswer } from './answer';
import { pendingBossFor, questionFor, roomStatuses } from './dungeon';
import { clearPlace, roomPoints } from './scoring';

export interface PlayResult {
	messages: ServerMessage[];
	notice?: string;
	progressChanged?: boolean;
}

const error = (code: string, message: string): ServerMessage => ({ type: 'error', code, message });

/**
 * Any plug on the house's current floor may be used. The table id sent by the
 * client decides which question is answered; there is no first/second priority.
 */
function plugRoom(stateRoom: number, tableId?: string): { room: number; error?: ServerMessage } {
	if (!tableId) return { room: stateRoom };
	const room = roomForTableId(tableId);
	if (room === null) {
		return { room: stateRoom, error: { type: 'notice', text: 'That socket has no power.' } };
	}
	if (floorForRoom(room) !== floorForRoom(stateRoom)) {
		return { room: stateRoom, error: { type: 'notice', text: 'That plug is on another floor.' } };
	}
	return { room };
}

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

	const target = plugRoom(state.room, tableId);
	if (target.error) return { messages: [target.error] };
	const room = target.room;
	const question = await questionFor(house, room);
	if (!question) {
		return { messages: [{ type: 'notice', text: 'No question in this plug.' }] };
	}

	const { floor, plug } = floorAndPlug(room);
	return {
		messages: [
			{
				type: 'question',
				room,
				floor,
				plug,
				plugId: questionTableIdForRoom(room),
				prompt: question.question,
				hint: null
			}
		]
	};
}

export async function submitAnswer(
	house: HouseId,
	answer: string,
	tableId?: string
): Promise<PlayResult> {
	const store = await getStore();
	const state = await store.getHouse(house);
	if (!state) return { messages: [error('NO_HOUSE', 'House state missing')] };

	const config = await liveConfig();
	if (state.status === 'boss' || pendingBossFor(state, config)) {
		return {
			messages: [{ type: 'notice', text: 'Clear the floor boss before answering more plugs.' }]
		};
	}

	const target = plugRoom(state.room, tableId);
	if (target.error) return { messages: [target.error] };
	const room = target.room;
	if (state.solvedRooms.includes(room)) {
		return { messages: [{ type: 'notice', text: 'This plug is already cleared.' }] };
	}

	const now = Date.now();
	if (state.answerLockUntil && state.answerLockUntil > now) {
		return {
			messages: [
				{ type: 'answerResult', correct: false, lockUntil: state.answerLockUntil }
			]
		};
	}

	const question = await questionFor(house, room);
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
			message: `Wrong answer on floor ${floorForRoom(room)} plug ${plugForRoom(room)}`,
			data: { questionId: question.id }
		});
		return { messages: [{ type: 'answerResult', correct: false, lockUntil }] };
	}

	const houses = await store.listHouses();
	const place = clearPlace(house, now, houses);
	const points = roomPoints(place, config);
	const clearedFloor = floorForRoom(room);
	const clearedPlug = plugForRoom(room);
	const clearedCount =
		state.solvedRooms.filter((solved) => floorForRoom(solved) === clearedFloor).length + 1;
	const allCleared = clearedCount >= config.game.plugsPerFloor;
	const bossPending =
		allCleared &&
		config.boss.bosses.some(
			(boss) => boss.floor === clearedFloor && !state.defeatedBosses.includes(boss.id)
		);
	const finished =
		allCleared && config.boss.bosses.every((boss) => state.defeatedBosses.includes(boss.id));

	// Progress is tracked per plug, but never gates which plug comes next.
	state.solvedRooms.push(room);
	state.room = room;
	state.status = bossPending ? 'boss' : finished ? 'solved' : 'open';
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
	return {
		messages: [
			{ type: 'answerResult', correct: true, lockUntil: null },
			{ type: 'state', state },
			{
				type: 'dungeon',
				current: state.room,
				...floorAndPlug(state.room),
				rooms: await roomStatuses(state)
			},
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
