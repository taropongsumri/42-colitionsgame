import type { HouseId } from '../../shared/types';
import { getStore } from '../db';
import { startClock, timeLeftMs } from './clock';
import { liveConfig } from '../config';

export interface ControlInput {
	action:
		| 'start'
		| 'pause'
		| 'resume'
		| 'addTime'
		| 'adjustScore'
		| 'forceUnlock'
		| 'forceBoss'
		| 'announce'
		| 'end';
	house?: HouseId;
	amount?: number;
	minutes?: number;
	reason?: string;
	text?: string;
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
			await store.appendLog({
				at: Date.now(),
				type: 'admin.score',
				house: house.id,
				message: `Score ${input.amount} (${input.reason ?? 'no reason'})`
			});
			break;
		}
		case 'forceUnlock': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house) return {};
			house.solvedRooms.push(house.room);
			house.room += 1;
			house.status = 'open';
			await store.saveHouse(house);
			await store.appendLog({
				at: Date.now(),
				type: 'admin.unlock',
				house: house.id,
				message: `Room ${house.room - 1} force-unlocked`
			});
			break;
		}
		case 'forceBoss': {
			if (!input.house) return {};
			const house = await store.getHouse(input.house);
			if (!house) return {};
			const { game } = await liveConfig();
			house.solvedRooms = Array.from({ length: game.roomCount }, (_, index) => index + 1);
			house.room = game.roomCount + 1;
			house.status = 'solved';
			await store.saveHouse(house);
			await store.appendLog({
				at: Date.now(),
				type: 'admin.bossUnlock',
				house: house.id,
				message: 'Lift unlocked by admin'
			});
			break;
		}
		case 'announce': {
			meta.announcement = input.text ?? '';
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
	await store.appendLog({
		at: Date.now(),
		type: 'admin.control',
		message: input.action
	});

	return input.action === 'announce' ? { notice: meta.announcement ?? '' } : {};
}
