import { liveConfig } from '../config';
import { getStore, type Store } from '../db';
import type { GameMeta } from '../db/types';

export const defaultMeta = (): GameMeta => ({
	startedAt: null,
	endsAt: null,
	paused: false,
	remainingMs: 0,
	announcement: null,
	finished: false,
	orbsHidden: false
});

export async function timeLeftMs(store?: Store): Promise<number> {
	const db = store ?? (await getStore());
	const meta = await db.getMeta();
	const config = await liveConfig();
	if (!meta.startedAt) return config.game.durationMinutes * 60 * 1000;
	if (meta.paused) return meta.remainingMs;
	return Math.max(0, (meta.endsAt ?? 0) - Date.now());
}

export async function startClock(): Promise<GameMeta> {
	const store = await getStore();
	const config = await liveConfig();
	const meta: GameMeta = {
		...defaultMeta(),
		startedAt: Date.now(),
		endsAt: Date.now() + config.game.durationMinutes * 60 * 1000
	};
	await store.saveMeta(meta);
	return meta;
}
