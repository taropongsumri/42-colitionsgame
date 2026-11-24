import {
	FLOOR_COUNT,
	QUESTIONS_PER_FLOOR,
	TOTAL_QUESTION_SLOTS,
	floorForRoom,
	plugForRoom,
	roomForFloorPlug
} from '../../shared/map';
import type { HouseId } from '../../shared/types';
import { audit } from '../audit';
import { getStore } from '../db';
import { startClock, timeLeftMs } from './clock';

export interface ControlInput {
	action:
		| 'start'
		| 'pause'
		| 'resume'
		| 'addTime'
		| 'adjustScore'
		| 'forceUnlock'
		| 'forceBoss'
		| 'clearBossRetry'
		| 'announce'
		| 'hideOrbs'
		| 'end';
	house?: HouseId;
	amount?: number;
	minutes?: number;
	reason?: string;
	text?: string;
	hidden?: boolean;
}

export async function control(input: ControlInput): Promise<{ notice?: string }> {
	const store = await getStore();
	let meta = await store.getMeta();

	switch (input.action) {
		case 'start': {
			meta = await startClock();
			break;
		}
		case 'pause': {
			if (meta.startedAt && !meta.paused && !meta.finished) {
				meta.remainingMs = await timeLeftMs(store);
				meta.paused = true;
			}
			break;
		}
		case 'resume': {
			if (meta.startedAt && meta.paused && !meta.finished) {
				meta.endsAt = Date.now() + meta.remainingMs;
				meta.paused = false;
			}
			break;
		}
		case 'addTime': {
			const minutes = Number(input.minutes ?? 0);
			if (!meta.startedAt) meta = await startClock();
			const delta = minutes * 60 * 1000;
			if (meta.paused) meta.remainingMs += delta;
			else meta.endsAt = (meta.endsAt ?? Date.now()) + delta;
			break;
		}
		case 'adjustScore': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house) return {};
			house.score += Number(input.amount ?? 0);
			house.adjustmentCount += 1;
			await store.saveHouse(house);
			await audit({
				type: 'admin.score',
				house: house.id,
				message: `Score ${input.amount} (${input.reason ?? 'no reason'})`
			});
			break;
		}
		case 'forceUnlock': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house || house.room > TOTAL_QUESTION_SLOTS) return {};
			const floor = floorForRoom(house.room);
			const plug = plugForRoom(house.room);
			if (!house.solvedRooms.includes(house.room)) house.solvedRooms.push(house.room);
			// Clearing plug six opens the lift but keeps the player on that floor
			// until the boss is beaten.
			if (plug === QUESTIONS_PER_FLOOR) {
				house.room = roomForFloorPlug(floor, QUESTIONS_PER_FLOOR);
				house.status = 'boss';
			} else {
				house.room += 1;
				house.status = 'open';
			}
			house.answerLockUntil = null;
			await store.saveHouse(house);
			await audit({
				type: 'admin.unlock',
				house: house.id,
				message: `Floor ${floor} plug ${plug} force-unlocked`
			});
			break;
		}
		case 'forceBoss': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house) return {};
			const floor = Math.min(FLOOR_COUNT, Math.max(1, floorForRoom(house.room)));
			const rooms = Array.from(
				{ length: QUESTIONS_PER_FLOOR },
				(_, index) => roomForFloorPlug(floor, index + 1)
			);
			house.solvedRooms = [...new Set([...house.solvedRooms, ...rooms])];
			house.room = roomForFloorPlug(floor, QUESTIONS_PER_FLOOR);
			house.status = 'boss';
			house.answerLockUntil = null;
			house.bossRetryAt = null;
			await store.saveHouse(house);
			await audit({
				type: 'admin.bossUnlock',
				house: house.id,
				message: `Floor ${floor} lift unlocked by admin`
			});
			break;
		}
		case 'clearBossRetry': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house) return {};
			house.bossRetryAt = null;
			if (!house.boss.active) house.status = 'boss';
			await store.saveHouse(house);
			await audit({
				type: 'admin.bossRetryCleared',
				house: house.id,
				message: 'Boss retry delay cleared by admin'
			});
			break;
		}
		case 'announce': {
			meta.announcement = input.text ?? '';
			break;
		}
		case 'hideOrbs': {
			meta.orbsHidden = input.hidden === true;
			break;
		}
		case 'end': {
			meta.finished = true;
			meta.paused = true;
			meta.remainingMs = 0;
			break;
		}
	}

	await store.saveMeta(meta);
	const discordEvent =
		input.action === 'start' ? 'game.start' : input.action === 'end' ? 'game.end' : 'admin.action';
	await audit({ type: 'admin.control', message: input.action }, discordEvent, { text: input.action });

	return input.action === 'announce' ? { notice: meta.announcement ?? '' } : {};
}
