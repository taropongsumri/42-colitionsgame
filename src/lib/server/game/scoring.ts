import type { LiveConfig } from '../../../../config';
import type { HouseId } from '../../shared/types';
import type { HouseState } from '../db/types';

export function bonusPercent(place: number, config: LiveConfig): number {
	return config.scoring.orderBonusPercent[place - 1] ?? 0;
}

/** Points for clearing a room, including the order bonus. */
export function roomPoints(place: number, config: LiveConfig): number {
	return Math.round(config.scoring.roomPoints * (1 + bonusPercent(place, config) / 100));
}

/** 1st = cleared earliest among houses at the same progress. */
export function clearPlace(
	self: HouseId,
	clearedAt: number,
	houses: readonly HouseState[]
): number {
	const ownProgress = houses.find((house) => house.id === self)?.solvedRooms.length ?? 0;
	const afterClear = ownProgress + 1;
	let place = 1;
	for (const house of houses) {
		if (house.id === self) continue;
		const progress = house.solvedRooms.length;
		if (
			progress > afterClear ||
			(progress === afterClear && house.lastClearAt !== null && house.lastClearAt < clearedAt)
		) {
			place += 1;
		}
	}
	return place;
}
