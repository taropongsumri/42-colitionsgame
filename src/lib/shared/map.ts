// Ported from the earlier pixel-art prototype's src/lib/shared/maps.ts.
// Each floor is one big white cluster room with round pizza tables. Every table has
// four iMacs and four black chairs; five tables per floor are question plugs.
//   # wall   . floor   T table   Q question table   S stairs   E lift   P spawn
//   D door between the outside forecourt and floor 1
// Outside (floor 0): B building, s steps, - paving, = road, g grass, Y tree.

export const TILE = 16;
export const QUESTIONS_PER_FLOOR = 5;

export type PropKind = 'table' | 'chair' | 'stairs' | 'elevator' | 'door' | 'tree';
export type Prop = {
	kind: PropKind;
	tx: number;
	ty: number;
	x: number;
	y: number;
	/** Question tables carry a stable id such as f1-r3. */
	roomId?: string;
	side?: 'n' | 's';
};
export type FloorMap = {
	floor: number;
	outdoor: boolean;
	rows: string[];
	w: number;
	h: number;
	props: Prop[];
	spawn: { x: number; y: number };
};

type FloorSpec = {
	w: number;
	h: number;
	tables: [number, number][];
	questions: [number, number][];
	pillars?: [number, number][];
	stairs: [number, number];
	lift: [number, number];
	spawn: [number, number];
	door?: [number, number];
};

const SPECS: FloorSpec[] = [
	{
		w: 40, h: 22,
		tables: [[4, 3], [18, 3], [25, 6], [7, 8], [15, 9], [29, 9], [36, 8], [12, 14], [19, 15], [27, 14], [8, 18], [24, 19], [31, 18]],
		questions: [[11, 4], [32, 4], [22, 10], [4, 13], [34, 14]],
		pillars: [[20, 7], [10, 11], [32, 11]],
		stairs: [35, 1], lift: [29, 1], spawn: [3, 19], door: [3, 20]
	},
	{
		w: 40, h: 22,
		tables: [[5, 4], [13, 3], [27, 3], [17, 10], [25, 9], [32, 11], [4, 14], [12, 15], [28, 15], [35, 16], [8, 19], [24, 19], [31, 19]],
		questions: [[20, 5], [35, 6], [9, 9], [20, 14], [16, 19]],
		pillars: [[13, 7], [29, 7], [24, 13]],
		stairs: [35, 1], lift: [29, 1], spawn: [3, 19]
	},
	{
		w: 40, h: 22,
		tables: [[6, 3], [21, 3], [33, 4], [10, 7], [16, 6], [26, 8], [36, 9], [3, 12], [13, 12], [22, 13], [30, 13], [10, 17], [25, 17]],
		questions: [[14, 3], [31, 7], [20, 9], [5, 15], [33, 16]],
		pillars: [[24, 4], [11, 10], [34, 11]],
		stairs: [35, 1], lift: [29, 1], spawn: [3, 19]
	},
	{
		w: 40, h: 22,
		tables: [[8, 4], [20, 4], [31, 3], [4, 9], [14, 10], [25, 10], [36, 7], [21, 8], [11, 15], [19, 16], [27, 15], [34, 17], [16, 19]],
		questions: [[13, 4], [25, 4], [30, 11], [7, 12], [22, 19]],
		pillars: [[17, 7], [28, 6], [8, 13]],
		stairs: [35, 1], lift: [29, 1], spawn: [3, 19]
	},
	{
		w: 40, h: 22,
		tables: [[5, 5], [13, 4], [24, 5], [33, 3], [9, 9], [18, 10], [29, 9], [36, 11], [4, 15], [15, 14], [23, 15], [32, 17], [12, 19]],
		questions: [[20, 7], [27, 13], [17, 18], [36, 15], [8, 12]],
		pillars: [[14, 7], [25, 11], [9, 17]],
		stairs: [35, 1], lift: [29, 1], spawn: [3, 19]
	}
];

/** One seat per pizza slice, just outside the table rim. */
export const CHAIR_OFFSETS: [number, number][] = [[-17, -9], [17, -9], [-17, 10], [17, 10]];

function buildRows(s: FloorSpec): string[] {
	const all = [...s.tables, ...s.questions];
	for (let i = 0; i < all.length; i++)
		for (let j = i + 1; j < all.length; j++) {
			const dx = Math.abs(all[i][0] - all[j][0]);
			const dy = Math.abs(all[i][1] - all[j][1]);
			if (dx < 4 && dy < 3)
				throw new Error(`tables at ${all[i]} and ${all[j]} overlap: keep 4 tiles apart horizontally or 3 vertically`);
		}
	const g: string[][] = Array.from({ length: s.h }, (_, y) =>
		Array.from({ length: s.w }, (_, x) => (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1 ? '#' : '.'))
	);
	const put = ([x, y]: [number, number], c: string) => {
		if (g[y]?.[x] !== '.') throw new Error(`cannot place ${c} at ${x},${y}: ${g[y]?.[x]}`);
		g[y][x] = c;
	};
	s.tables.forEach((p) => put(p, 'T'));
	s.questions.forEach((p) => put(p, 'Q'));
	s.pillars?.forEach((p) => put(p, '#'));
	put(s.stairs, 'S');
	put([s.stairs[0] + 1, s.stairs[1]], 'S');
	put(s.lift, 'E');
	put([s.lift[0] + 1, s.lift[1]], 'E');
	put(s.spawn, 'P');
	if (s.door) put(s.door, 'D');
	return g.map((row) => row.join(''));
}

export function parseFloor(floor: number, rows: string[]): FloorMap {
	const w = rows[0].length;
	rows.forEach((row, i) => {
		if (row.length !== w) throw new Error(`floor ${floor} row ${i} is ${row.length} wide, expected ${w}`);
	});
	const props: Prop[] = [];
	let spawn = { x: TILE * 1.5, y: TILE * 1.5 };
	const seen = new Set<string>();
	let rooms = 0;
	rows.forEach((row, ty) =>
		[...row].forEach((c, tx) => {
			const center = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
			if (c === 'T' || c === 'Q') {
				props.push({
					kind: 'table', tx, ty, ...center,
					...(c === 'Q' ? { roomId: `f${floor}-r${++rooms}` } : {})
				});
				for (const [dx, dy] of CHAIR_OFFSETS)
					props.push({ kind: 'chair', tx, ty, x: center.x + dx, y: center.y + dy, side: dy < 0 ? 'n' : 's' });
			}
			if (c === 'P') spawn = { x: center.x, y: center.y + 4 };
			if (c === 'Y') props.push({ kind: 'tree', tx, ty, x: center.x, y: center.y + 4 });
			if (c === 'D' && !seen.has(`${tx},${ty}`)) {
				const pair = row[tx + 1] === 'D';
				if (pair) seen.add(`${tx + 1},${ty}`);
				props.push({ kind: 'door', tx, ty, x: pair ? (tx + 1) * TILE : center.x, y: center.y });
			}
			if ((c === 'S' || c === 'E') && !seen.has(`${tx},${ty}`)) {
				seen.add(`${tx + 1},${ty}`);
				props.push({
					kind: c === 'S' ? 'stairs' : 'elevator',
					tx, ty, x: (tx + 1) * TILE, y: center.y
				});
			}
		})
	);
	return { floor, outdoor: floor === 0, rows, w, h: rows.length, props, spawn };
}

function outsideRows(): string[] {
	const W = 40, H = 22;
	const trees = new Set(['2,3', '3,9', '37,4', '36,11', '2,13', '6,20', '14,20', '24,20', '33,20', '38,19', '1,6', '38,8']);
	const rows: string[] = [];
	for (let y = 0; y < H; y++) {
		let row = '';
		for (let x = 0; x < W; x++) {
			let c = 'g';
			if (y <= 7) c = x >= 6 && x <= 33 ? 'B' : 'g';
			else if (y <= 9) c = x >= 14 && x <= 25 ? 's' : x >= 6 && x <= 33 ? '-' : 'g';
			else if (y <= 13) c = x >= 4 && x <= 35 ? '-' : 'g';
			else if (y === 14 || y === 18) c = '-';
			else if (y <= 17) c = '=';
			if (y === 8 && (x === 19 || x === 20)) c = 'D';
			if (y === 18 && x === 8) c = 'P';
			if (trees.has(`${x},${y}`)) c = 'Y';
			row += c;
		}
		rows.push(row);
	}
	return rows;
}

/** Floor 0 is the KLLC forecourt; floors 1-5 are the white cluster rooms. */
export const FLOORS: FloorMap[] = [
	parseFloor(0, outsideRows()),
	...SPECS.map((spec, index) => parseFloor(index + 1, buildRows(spec)))
];

export const tileAt = (map: FloorMap, tx: number, ty: number): string =>
	ty < 0 || ty >= map.h || tx < 0 || tx >= map.w ? '#' : map.rows[ty][tx];
export const isWall = (c: string) => c === '#' || c === 'B';

/** Room 1-5 live on floor 1, room 6-10 on floor 2, and so on. */
export function floorForRoom(room: number): number {
	return Math.max(1, Math.ceil(Math.max(1, room) / QUESTIONS_PER_FLOOR));
}

export function questionIndexForRoom(room: number): number {
	return (Math.max(1, room) - 1) % QUESTIONS_PER_FLOOR;
}

export function questionTableIdForRoom(room: number): string {
	return `f${floorForRoom(room)}-r${questionIndexForRoom(room) + 1}`;
}

/** Another plug on the same floor hides the hint for the current question. */
export function hintTableIdForRoom(room: number): string {
	const floor = floorForRoom(room);
	const next = (questionIndexForRoom(room) + 1) % QUESTIONS_PER_FLOOR;
	return `f${floor}-r${next + 1}`;
}

export function questionTableIds(floor: number): string[] {
	return FLOORS.find((map) => map.floor === floor)?.props
		.filter((prop): prop is Prop & { roomId: string } => prop.kind === 'table' && !!prop.roomId)
		.map((prop) => prop.roomId) ?? [];
}

export function floorByNumber(floor: number): FloorMap {
	return FLOORS.find((map) => map.floor === floor) ?? FLOORS[1];
}
