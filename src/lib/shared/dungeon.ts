import type { HouseId } from './types';

const HOUSE_ORDER: Record<HouseId, number> = { h1: 0, h2: 1, h3: 2 };

/** The powered table in a room. The socket visibly glows so players can find it. */
export function realTableFor(house: HouseId, room: number): string {
	return `t${(room + HOUSE_ORDER[house]) % 4}`;
}

export function hintTableFor(house: HouseId, room: number): string {
	return `t${((room + HOUSE_ORDER[house]) % 4 + 2) % 4}`;
}

export const TABLE_IDS = ['t0', 't1', 't2', 't3'] as const;
