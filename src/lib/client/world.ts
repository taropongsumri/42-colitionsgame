// Movement and collision for the ported prototype map. Positions are feet in world pixels.
import { TILE, isWall, tileAt, type FloorMap, type Prop } from '../shared/map';

export const FEET_R = 5;
export const TABLE_RX = 16;
export const TABLE_RY = 9;
const CHAIR_R = 4;

function hitsWall(map: FloorMap, x: number, y: number): boolean {
	const x0 = Math.floor((x - FEET_R) / TILE), x1 = Math.floor((x + FEET_R) / TILE);
	const y0 = Math.floor((y - FEET_R) / TILE), y1 = Math.floor(y / TILE);
	for (let ty = y0; ty <= y1; ty++)
		for (let tx = x0; tx <= x1; tx++)
			if (isWall(tileAt(map, tx, ty))) return true;
	return false;
}

function hitsFurniture(map: FloorMap, x: number, y: number): boolean {
	for (const prop of map.props) {
		if (prop.kind === 'table') {
			const dx = (x - prop.x) / (TABLE_RX + FEET_R - 2);
			const dy = (y - prop.y) / (TABLE_RY + FEET_R - 3);
			if (dx * dx + dy * dy < 1) return true;
		} else if (prop.kind === 'tree') {
			if (Math.hypot(x - prop.x, (y - prop.y) * 1.4) < 5 + FEET_R) return true;
		} else if (prop.kind === 'chair') {
			if (Math.hypot(x - prop.x, (y - prop.y) * 1.3) < CHAIR_R + FEET_R - 1) return true;
		}
	}
	return false;
}

export const blocked = (map: FloorMap, x: number, y: number) =>
	hitsWall(map, x, y) || hitsFurniture(map, x, y);

/** Resolve x and y separately so the character slides along walls. */
export function move(map: FloorMap, pos: { x: number; y: number }, dx: number, dy: number) {
	if (dx && !blocked(map, pos.x + dx, pos.y)) pos.x += dx;
	if (dy && !blocked(map, pos.x, pos.y + dy)) pos.y += dy;
}

export function transportAt(map: FloorMap, x: number, y: number): Prop | null {
	const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
	const tile = tileAt(map, tx, ty);
	if (tile !== 'S' && tile !== 'E' && tile !== 'D') return null;
	const kind = tile === 'S' ? 'stairs' : tile === 'E' ? 'elevator' : 'door';
	return map.props.find((prop) => prop.kind === kind && prop.ty === ty && (prop.tx === tx || prop.tx + 1 === tx)) ?? null;
}
