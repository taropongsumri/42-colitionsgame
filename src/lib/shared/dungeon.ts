import { hintTableIdForRoom, questionTableIdForRoom, QUESTIONS_PER_FLOOR, FLOORS } from './map';
import type { HouseId } from './types';

/**
 * The powered question plug for a room. All houses share the same map (as in the
 * original design); each house receives a different question for that room.
 */
export function realTableFor(_house: HouseId, room: number): string {
	return questionTableIdForRoom(room);
}

/** A different plug on the same floor can reveal the hint. */
export function hintTableFor(_house: HouseId, room: number): string {
	return hintTableIdForRoom(room);
}

export const TABLE_IDS: readonly string[] = FLOORS.flatMap((floor) =>
	floor.props.filter((prop) => prop.roomId).map((prop) => prop.roomId as string)
);

export { QUESTIONS_PER_FLOOR };
