import type { ServerMessage } from '../../shared/protocol';
import type { HouseId } from '../../shared/types';
import { liveConfig } from '../config';
import { getStore } from '../db';
import { isCorrectAnswer } from './answer';
import { questionFor, roomStatuses, tablesFor } from './dungeon';
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

	const question = await questionFor(house, state.room);
	if (!question) {
		return { messages: [{ type: 'notice', text: 'Dungeon cleared — the boss awaits.' }] };
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

	return {
		messages: [
			{ type: 'question', room: state.room, prompt: question.question, hint: null }
		]
	};
}

export async function submitAnswer(house: HouseId, answer: string): Promise<PlayResult> {
	const store = await getStore();
	const state = await store.getHouse(house);
	if (!state) return { messages: [error('NO_HOUSE', 'House state missing')] };

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
		return { messages: [{ type: 'notice', text: 'No question in this room.' }] };
	}

	const config = await liveConfig();

	if (!isCorrectAnswer(answer, question)) {
		const lockUntil = now + config.game.wrongAnswerLockSeconds * 1000;
		state.answerLockUntil = lockUntil;
		await store.saveHouse(state);
		await store.appendLog({
			at: now,
			type: 'answer.wrong',
			house,
			message: `Wrong answer in room ${state.room}`,
			data: { questionId: question.id }
		});
		return { messages: [{ type: 'answerResult', correct: false, lockUntil }] };
	}

	const houses = await store.listHouses();
	const place = clearPlace(house, now, houses);
	const points = roomPoints(place, config);

	state.solvedRooms.push(state.room);
	state.room += 1;
	state.status = state.room > config.game.roomCount ? 'solved' : 'open';
	state.score += points;
	state.lastClearAt = now;
	state.answerLockUntil = null;
	await store.saveHouse(state);

	await store.appendLog({
		at: now,
		type: 'answer.correct',
		house,
		message: `Room ${state.room - 1} cleared (+${points})`,
		data: { questionId: question.id, place, points }
	});

	const ordinal = ['1st', '2nd', '3rd'][place - 1] ?? `${place}th`;
	return {
		messages: [
			{ type: 'answerResult', correct: true, lockUntil: null },
			{ type: 'state', state },
			{ type: 'dungeon', current: state.room, rooms: await roomStatuses(state) },
			{ type: 'notice', text: `${ordinal} to clear! +${points} points.` }
		],
		notice: `${house} cleared room ${state.room - 1} (${ordinal})`,
		progressChanged: true
	};
}
