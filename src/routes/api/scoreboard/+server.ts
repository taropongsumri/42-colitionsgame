import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStore } from '$lib/server/db';
import { timeLeftMs } from '$lib/server/game/clock';
import { floorAndPlug } from '$lib/shared/map';

export const GET: RequestHandler = async () => {
	const store = await getStore();
	const [houses, meta, left] = await Promise.all([
		store.listHouses(),
		store.getMeta(),
		timeLeftMs(store)
	]);
	return json({
		rows: houses.map((house) => ({
			house: house.id,
			score: house.score,
			room: house.room,
			...floorAndPlug(house.room),
			hp: house.hp,
			solved: house.solvedRooms.length
		})),
		timeLeftMs: left,
		paused: meta.paused,
		finished: meta.finished,
		announcement: meta.announcement
	});
};
