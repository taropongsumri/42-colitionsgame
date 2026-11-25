// 2.5D renderer ported from the original prototype. Floor first, then walls, tables,
// chairs and actors sorted by base y, so anything further north is drawn behind.
import { TILE, isWall, tileAt, type FloorMap, type Prop } from '../shared/map';
import { TABLE_RX, TABLE_RY } from './world';

const WALL_H = 16;

export type Viewport = { w: number; h: number };
export type Camera = { x: number; y: number };
export type Actor = {
	x: number;
	y: number;
	img: HTMLImageElement | null;
	flip?: boolean;
	bob?: number;
	alpha?: number;
	ghost?: string;
	/** Spectator light orb colour; orbs float and ignore fog of war. */
	orb?: string;
	/** Fire/water cosmetic skin chosen by the spectator. */
	skin?: 'fire' | 'water';
	/** Pixel-art fire orb sprite; drawn crisp instead of the vector fallback. */
	orbSprite?: HTMLImageElement | null;
	/** Optional house label drawn above full-colour actors. */
	name?: string;
	nameColor?: string;
	/** Sprint state drives the lean, dust, afterimages and faster gait. */
	sprint?: boolean;
	gait?: number;
	dirX?: number;
	dirY?: number;
};
export type RenderState = {
	solved: Set<string>;
	near: string | null;
	/** The question plug for the house's current room; it glows brighter. */
	highlight: string | null;
	/** After a correct answer, a red arrow points at the next plug. */
	next?: string | null;
	/** Player world position, so plug arrows can rotate toward the player. */
	player?: { x: number; y: number } | null;
	/** Spectators can see the boss gate on every lift. */
	bossGate?: boolean;
	/** The old prototype's backroom backdrop, drawn behind the white floors. */
	background?: HTMLImageElement | null;
};

const C = {
	floor: '#e7e8eb', floorSeam: '#d9dbdf', floorShine: '#eff0f2',
	wallTop: '#b9bcc4', wallTopHi: '#d3d5db', wallFace: '#f4f4f6', wallPanel: '#e6e7ea',
	wallLip: '#9a9ea8', baseboard: '#a7abb4',
	tableTop: '#fbfbfc', tableEdge: '#d4d6db', tableLine: '#dcdee3', outline: '#3b3d46',
	tableLeg: '#8d9099', hole: '#2c2e35', pins: '#c9cdd4',
	macBody: '#cfd2d8', macBack: '#e3e5e9', macScreen: '#1c2533', macChin: '#b8bbc3',
	chair: '#1c1c21', chairHi: '#3a3a44', chairLeg: '#0f0f12',
	shadow: 'rgba(40,44,60,0.18)'
};

const O = {
	grass: '#79bf63', grassDark: '#62a650', paving: '#dcd6c8', pavingSeam: '#c8c1b1',
	step: '#e6e4df', stepEdge: '#bdb9b1', road: '#4a4e57', roadLine: '#f1f1f1', curb: '#c9c4b8',
	trunk: '#6b4a32', leaf: '#3f8f4a', leafHi: '#5fb35e', leafDark: '#2d6b39'
};

const CODE_COLORS = ['#6fb2ff', '#7be39a', '#ffc23c', '#ff7eb6', '#c59bff', '#5ee6e6'];
const POSTERS = [
	['#ff7a59', '#ffd166', '#ffffff'],
	['#3a86ff', '#8ecae6', '#ffffff'],
	['#2ec4b6', '#cbf3f0', '#1b1d24'],
	['#9b5de5', '#f15bb5', '#fee440'],
	['#1b1d24', '#00f5d4', '#ffffff']
];

const silhouettes = new Map<string, HTMLCanvasElement>();

function silhouette(img: HTMLImageElement, color: string): HTMLCanvasElement {
	const key = img.src + color;
	let canvas = silhouettes.get(key);
	if (!canvas) {
		canvas = document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(img, 0, 0);
		ctx.globalCompositeOperation = 'source-atop';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		silhouettes.set(key, canvas);
	}
	return canvas;
}

function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
	ctx.fillStyle = color;
	for (let dy = -ry; dy <= ry; dy++) {
		const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
		ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
	}
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, alpha = 1) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.font = '6px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#2a2c33';
	ctx.fillText(text, x + 1, y + 1);
	ctx.fillStyle = color;
	ctx.fillText(text, x, y);
	ctx.restore();
}

const ARROW_PIXEL = 2;
const arrowSprites = new Map<string, HTMLCanvasElement>();

/** Chunky right-facing arrow sprite, drawn on whole pixels and cached by colour. */
function pixelArrow(color: string, outline: string): HTMLCanvasElement {
	const key = `${color}|${outline}`;
	const cached = arrowSprites.get(key);
	if (cached) return cached;

	const sprite = document.createElement('canvas');
	sprite.width = 10 * ARROW_PIXEL;
	sprite.height = 9 * ARROW_PIXEL;
	const c = sprite.getContext('2d')!;
	const rows = [
		'........#.',
		'.......##.',
		'......###.',
		'#########.',
		'#########.',
		'......###.',
		'.......##.',
		'........#.'
	];
	const paint = (fill: string, ox: number, oy: number) => {
		c.fillStyle = fill;
		for (let y = 0; y < rows.length; y += 1) {
			for (let x = 0; x < rows[y].length; x += 1) {
				if (rows[y][x] === '#') {
					c.fillRect(x * ARROW_PIXEL + ox, y * ARROW_PIXEL + oy, ARROW_PIXEL, ARROW_PIXEL);
				}
			}
		}
	};
	paint(outline, -ARROW_PIXEL, 0);
	paint(outline, ARROW_PIXEL, 0);
	paint(outline, 0, -ARROW_PIXEL);
	paint(outline, 0, ARROW_PIXEL);
	paint(color, 0, 0);
	c.globalAlpha = 0.35;
	c.fillStyle = '#ffffff';
	c.fillRect(0, 3 * ARROW_PIXEL, 7 * ARROW_PIXEL, ARROW_PIXEL);
	c.globalAlpha = 1;
	arrowSprites.set(key, sprite);
	return sprite;
}

/** Draws the pixel arrow at any angle; angle 0 points right. */
function drawPixelArrow(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	angle: number,
	color: string,
	outline: string
) {
	const sprite = pixelArrow(color, outline);
	ctx.save();
	ctx.translate(Math.round(x), Math.round(y));
	ctx.rotate(angle);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
	ctx.restore();
}

/** Orbit the plug on the player's side so the arrow can point at it from any direction. */
function plugArrowPose(
	prop: Prop,
	cx: number,
	cy: number,
	player: { x: number; y: number } | null | undefined,
	t: number
) {
	if (!player) {
		return {
			x: cx,
			y: cy - 30 + Math.round(Math.sin(t * 6) * 3),
			angle: Math.PI / 2
		};
	}
	const dx = player.x - prop.x;
	const dy = player.y - prop.y;
	const length = Math.hypot(dx, dy);
	if (length < 1) {
		return {
			x: cx,
			y: cy - 30 + Math.round(Math.sin(t * 6) * 3),
			angle: Math.PI / 2
		};
	}
	const ux = dx / length;
	const uy = dy / length;
	const orbit = 26 + Math.round(Math.sin(t * 6) * 2);
	const x = cx + ux * orbit;
	const y = cy + uy * (orbit * 0.7);
	return { x, y, angle: Math.atan2(cy - y, cx - x) };
}

function drawOutdoorTile(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, tx: number, ty: number) {
	if (c === 'g' || c === 'Y') {
		ctx.fillStyle = O.grass;
		ctx.fillRect(x, y, TILE, TILE);
		const h = (tx * 31 + ty * 17) % 11;
		ctx.fillStyle = O.grassDark;
		ctx.fillRect(x + (h % 13), y + ((h * 5) % 13), 1, 2);
		ctx.fillRect(x + ((h * 7) % 13) + 1, y + ((h * 3) % 12) + 2, 1, 2);
	} else if (c === 's' || c === 'D') {
		ctx.fillStyle = O.step;
		ctx.fillRect(x, y, TILE, TILE);
		ctx.fillStyle = O.stepEdge;
		ctx.fillRect(x, y + 5, TILE, 1);
		ctx.fillRect(x, y + 11, TILE, 1);
	} else if (c === '=') {
		ctx.fillStyle = O.road;
		ctx.fillRect(x, y, TILE, TILE);
		if (ty === 16 && tx % 3 !== 2) {
			ctx.fillStyle = O.roadLine;
			ctx.fillRect(x + 2, y + 7, 12, 2);
		}
	} else {
		ctx.fillStyle = O.paving;
		ctx.fillRect(x, y, TILE, TILE);
		ctx.fillStyle = O.pavingSeam;
		ctx.fillRect(x, y, TILE, 1);
		ctx.fillRect(x, y, 1, TILE);
		if (ty === 14 || ty === 18) {
			ctx.fillStyle = O.curb;
			ctx.fillRect(x, ty === 14 ? y + 14 : y, TILE, 2);
		}
	}
}

function drawBuilding(ctx: CanvasRenderingContext2D, cam: Camera) {
	const x0 = 6 * TILE - cam.x, x1 = 34 * TILE - cam.x;
	const y0 = -cam.y, base = 8 * TILE - cam.y;
	const width = x1 - x0, mid = Math.round(x0 + width / 2);
	ctx.fillStyle = '#8f8d89'; ctx.fillRect(x0, y0, width, 44);
	ctx.fillStyle = '#a9a7a2'; ctx.fillRect(x0, y0 + 34, width, 10);
	ctx.fillStyle = '#6e6c68'; ctx.fillRect(x0, y0 + 44, width, 2);
	const fy = y0 + 46;
	ctx.fillStyle = '#c9653d'; ctx.fillRect(x0, fy, width, base - fy);
	ctx.fillStyle = '#b4552f';
	for (let yy = fy + 3; yy < base; yy += 4) ctx.fillRect(x0, yy, width, 1);
	ctx.fillStyle = '#7b4029'; ctx.fillRect(x0 + 16, fy + 6, width - 32, 22);
	ctx.fillStyle = '#e9ddd0';
	for (let yy = fy + 8; yy < fy + 27; yy += 3) ctx.fillRect(x0 + 18, yy, width - 36, 1);
	ctx.save();
	ctx.font = '6px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#3c3a37'; ctx.fillText('KMITL LIFELONG LEARNING CENTER', mid + 1, y0 + 40);
	ctx.fillStyle = '#ffffff'; ctx.fillText('KMITL LIFELONG LEARNING CENTER', mid, y0 + 39);
	ctx.restore();
	for (const side of [-1, 1]) {
		for (let i = 0; i < 5; i++) {
			const wx = mid + side * (70 + i * 36) - (side < 0 ? 24 : 0);
			ctx.fillStyle = '#5b3424'; ctx.fillRect(wx - 1, base - 33, 26, 22);
			ctx.fillStyle = '#2f4250'; ctx.fillRect(wx, base - 32, 24, 20);
			ctx.fillStyle = '#5f7d8f'; ctx.fillRect(wx + 2, base - 30, 6, 1); ctx.fillRect(wx + 2, base - 28, 3, 1);
		}
	}
	ctx.fillStyle = '#1f2c37'; ctx.fillRect(mid - 26, base - 36, 52, 36);
	ctx.fillStyle = '#3d5566';
	for (let i = 0; i < 4; i++) ctx.fillRect(mid - 25 + i * 13, base - 35, 12, 35);
	ctx.fillStyle = '#7fa3b8'; ctx.fillRect(mid - 22, base - 33, 4, 1); ctx.fillRect(mid + 4, base - 31, 5, 1);
	ctx.fillStyle = '#ffcf5a'; ctx.fillRect(mid - 10, base - 44, 20, 6);
	ctx.save();
	ctx.font = '5px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	ctx.fillStyle = '#1b1d24'; ctx.fillText('42', mid, base - 41);
	ctx.restore();
	ctx.fillStyle = 'rgba(170,210,230,0.55)'; ctx.fillRect(mid - 64, base - 58, 128, 10);
	ctx.fillStyle = '#58616c';
	ctx.fillRect(mid - 64, base - 58, 128, 1); ctx.fillRect(mid - 64, base - 49, 128, 2);
	for (let i = 0; i <= 8; i++) ctx.fillRect(mid - 64 + i * 16, base - 58, 1, 10);
	for (const px of [mid - 50, mid + 42]) {
		ctx.fillStyle = '#d9d9d6'; ctx.fillRect(px, base - 47, 9, 47);
		ctx.fillStyle = '#f4f4f2'; ctx.fillRect(px + 2, base - 47, 2, 47);
		ctx.fillStyle = '#a9a9a6'; ctx.fillRect(px + 7, base - 47, 2, 47);
	}
	for (const px of [mid - 90, mid + 78]) {
		ctx.fillStyle = '#6d6a66'; ctx.fillRect(px, base - 8, 14, 8);
		ctx.fillStyle = '#4f9a4f'; ctx.fillRect(px + 1, base - 13, 12, 6);
		ctx.fillStyle = '#6cc06a'; ctx.fillRect(px + 3, base - 13, 4, 2);
	}
}

function drawTree(ctx: CanvasRenderingContext2D, prop: Prop, cam: Camera, t: number) {
	const x = Math.round(prop.x - cam.x), y = Math.round(prop.y - cam.y);
	ellipse(ctx, x, y + 1, 9, 3, 'rgba(20,40,20,0.25)');
	ctx.fillStyle = O.trunk; ctx.fillRect(x - 2, y - 12, 4, 13);
	const sway = Math.round(Math.sin(t * 1.3 + prop.tx));
	ellipse(ctx, x + sway, y - 20, 12, 10, O.leafDark);
	ellipse(ctx, x + sway, y - 22, 11, 9, O.leaf);
	ellipse(ctx, x - 3 + sway, y - 25, 5, 4, O.leafHi);
}

function drawFloorTile(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number) {
	ctx.fillStyle = C.floor; ctx.fillRect(x, y, TILE, TILE);
	ctx.fillStyle = C.floorSeam; ctx.fillRect(x, y, TILE, 1); ctx.fillRect(x, y, 1, TILE);
	if ((tx + ty * 3) % 7 === 0) {
		ctx.fillStyle = C.floorShine; ctx.fillRect(x + 3, y + 3, 6, 1);
	}
}

function drawPoster(ctx: CanvasRenderingContext2D, x: number, y: number, index: number) {
	const [bg, shape, text] = POSTERS[index];
	ctx.fillStyle = C.wallLip; ctx.fillRect(x - 1, y - 1, 11, 11);
	ctx.fillStyle = bg; ctx.fillRect(x, y, 9, 9);
	ctx.fillStyle = shape; ctx.fillRect(x + 2, y + 2, 5, 4); ctx.fillRect(x + 3, y + 1, 3, 6);
	ctx.fillStyle = text; ctx.fillRect(x + 1, y + 7, 7, 1);
}

function drawWall(ctx: CanvasRenderingContext2D, map: FloorMap, tx: number, ty: number, x: number, y: number) {
	const top = y - WALL_H;
	ctx.fillStyle = C.wallTop; ctx.fillRect(x, top, TILE, TILE);
	if (!isWall(tileAt(map, tx, ty - 1))) {
		ctx.fillStyle = C.wallTopHi; ctx.fillRect(x, top, TILE, 1);
	}
	if (!isWall(tileAt(map, tx, ty + 1))) {
		const fy = top + TILE;
		ctx.fillStyle = C.wallFace; ctx.fillRect(x, fy, TILE, WALL_H);
		ctx.fillStyle = C.wallPanel; ctx.fillRect(x + TILE - 1, fy + 1, 1, WALL_H - 3);
		ctx.fillStyle = C.wallLip; ctx.fillRect(x, fy, TILE, 1);
		ctx.fillStyle = C.baseboard; ctx.fillRect(x, fy + WALL_H - 2, TILE, 2);
		const hash = (tx * 73856093) ^ (ty * 19349663) ^ (map.floor * 83492791);
		if (ty === 0 && (hash >>> 0) % 5 === 0) drawPoster(ctx, x + 3, fy + 2, (hash >>> 3) % POSTERS.length);
	}
}

function drawMac(ctx: CanvasRenderingContext2D, x: number, y: number, front: boolean, t = 0, seed = 0) {
	ctx.fillStyle = C.tableLeg; ctx.fillRect(x, y, 1, 2);
	ctx.fillStyle = C.outline; ctx.fillRect(x - 4, y - 6, 9, 7);
	ctx.fillStyle = front ? C.macBody : C.macBack; ctx.fillRect(x - 3, y - 5, 7, 5);
	if (front) {
		ctx.fillStyle = C.macScreen; ctx.fillRect(x - 2, y - 4, 5, 3);
		const step = Math.floor(t * 2.5 + seed * 7);
		for (let i = 0; i < 3; i++) {
			const k = step + i;
			const len = 1 + ((k * 7 + seed * 3) % 4);
			const indent = (k * 5 + seed) % 3 === 0 ? 1 : 0;
			ctx.fillStyle = CODE_COLORS[(k * 3 + seed) % CODE_COLORS.length];
			ctx.fillRect(x - 2 + indent, y - 4 + i, Math.min(len, 5 - indent), 1);
		}
		ctx.fillStyle = C.macChin; ctx.fillRect(x - 3, y - 1, 7, 1);
	} else {
		ctx.fillStyle = C.macBody; ctx.fillRect(x - 1, y - 4, 3, 2);
	}
}

function drawTable(ctx: CanvasRenderingContext2D, prop: Prop, cam: Camera, st: RenderState, t: number) {
	const cx = Math.round(prop.x - cam.x), cy = Math.round(prop.y - cam.y) - 5;
	ellipse(ctx, cx, cy + 14, TABLE_RX - 3, 3, C.shadow);
	ctx.fillStyle = C.outline; ctx.fillRect(cx - 3, cy + 3, 7, 11);
	ctx.fillStyle = C.tableLeg; ctx.fillRect(cx - 2, cy + 3, 5, 10);
	ellipse(ctx, cx, cy + 2, TABLE_RX + 1, TABLE_RY + 1, C.outline);
	ellipse(ctx, cx, cy + 2, TABLE_RX, TABLE_RY, C.tableEdge);
	ellipse(ctx, cx, cy, TABLE_RX, TABLE_RY, C.tableTop);
	ctx.fillStyle = C.tableLine;
	ctx.fillRect(cx - TABLE_RX + 1, cy, TABLE_RX * 2 - 1, 1);
	ctx.fillRect(cx, cy - TABLE_RY + 1, 1, TABLE_RY * 2 - 1);
	drawMac(ctx, cx - 9, cy - 3, false);
	drawMac(ctx, cx + 10, cy - 3, false);

	ctx.fillStyle = C.hole; ctx.fillRect(cx - 2, cy - 1, 5, 3);
	ctx.fillStyle = C.pins; ctx.fillRect(cx - 1, cy, 1, 1); ctx.fillRect(cx + 1, cy, 1, 1);
	if (prop.roomId) {
		const solved = st.solved.has(prop.roomId);
		const current = prop.roomId === st.highlight;
		const pulse = solved ? 0.45 : current ? 0.65 + Math.sin(t * 4) * 0.3 : 0.2 + Math.sin(t * 2) * 0.08;
		const color = solved ? '120,230,150' : '255,190,60';
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		const glow = ctx.createRadialGradient(cx + 0.5, cy, 0, cx + 0.5, cy, current ? 16 : 11);
		glow.addColorStop(0, `rgba(${color},${pulse})`);
		glow.addColorStop(1, `rgba(${color},0)`);
		ctx.fillStyle = glow;
		const reach = current ? 16 : 11;
		ctx.fillRect(cx - reach, cy - reach, reach * 2 + 1, reach * 2);
		ctx.restore();
		ctx.fillStyle = solved ? '#7be39a' : current ? '#ffc23c' : '#d9a441';
		ctx.fillRect(cx - 1, cy, 1, 1); ctx.fillRect(cx + 1, cy, 1, 1);
		if (st.near === prop.roomId || (current && st.near === prop.roomId)) {
			ctx.fillStyle = '#ffffff';
			const by = cy - 22 + Math.round(Math.sin(t * 5));
			ctx.fillRect(cx - 1, by, 3, 3); ctx.fillRect(cx, by + 3, 1, 2);
		}
		if (current && !solved && st.next !== prop.roomId) {
			// Persistent pixel marker for the plug the player still has to visit.
			const pose = plugArrowPose(prop, cx, cy, st.player, t);
			drawPixelArrow(ctx, pose.x, pose.y, pose.angle, '#ffd166', '#4a3200');
			label(ctx, 'GO', pose.x, pose.y - 12, '#ffe6a8', 0.95);
		}
		if (st.next === prop.roomId) {
			// Red pixel arrow that rotates to point at the next plug from any side.
			const pose = plugArrowPose(prop, cx, cy, st.player, t);
			drawPixelArrow(ctx, pose.x, pose.y, pose.angle, '#ff3b4e', '#3a0a12');
			label(ctx, 'NEXT', pose.x, pose.y - 12, '#ff6b7a', 0.95);
		}
	}
	drawMac(ctx, cx - 9, cy + 7, true, t, prop.tx * 3 + prop.ty);
	drawMac(ctx, cx + 10, cy + 7, true, t, prop.tx + prop.ty * 5 + 1);
}

function drawChair(ctx: CanvasRenderingContext2D, prop: Prop, cam: Camera) {
	const x = Math.round(prop.x - cam.x), y = Math.round(prop.y - cam.y);
	ellipse(ctx, x, y + 2, 4, 1, C.shadow);
	ctx.fillStyle = C.chairLeg; ctx.fillRect(x - 3, y, 1, 2); ctx.fillRect(x + 3, y, 1, 2);
	if (prop.side === 'n') {
		ctx.fillStyle = C.chair; ctx.fillRect(x - 4, y - 10, 9, 6);
		ctx.fillStyle = C.chairHi; ctx.fillRect(x - 3, y - 9, 7, 1);
		ctx.fillStyle = C.chair; ctx.fillRect(x - 4, y - 4, 9, 4);
		ctx.fillStyle = C.chairHi; ctx.fillRect(x - 3, y - 4, 7, 1);
	} else {
		ctx.fillStyle = C.chair; ctx.fillRect(x - 4, y - 5, 9, 3);
		ctx.fillStyle = C.chairHi; ctx.fillRect(x - 3, y - 5, 7, 1);
		ctx.fillStyle = C.chair; ctx.fillRect(x - 4, y - 8, 9, 7);
		ctx.fillStyle = C.chairHi; ctx.fillRect(x - 3, y - 7, 1, 5);
	}
}

function drawTransport(
	ctx: CanvasRenderingContext2D,
	prop: Prop,
	cam: Camera,
	t: number,
	outdoor: boolean,
	bossGate = false
) {
	const x = Math.round(prop.tx * TILE - cam.x), y = Math.round(prop.ty * TILE - cam.y);
	if (prop.kind === 'door') {
		if (outdoor) label(ctx, 'ENTER', Math.round(prop.x - cam.x), y + 8, '#ffcf5a', 0.85 + Math.sin(t * 3) * 0.15);
		else {
			ctx.fillStyle = '#4b5563'; ctx.fillRect(x + 1, y + 2, TILE - 2, TILE - 4);
			ctx.fillStyle = '#6b7280'; ctx.fillRect(x + 2, y + 3, TILE - 4, 1);
			label(ctx, 'OUT', x + TILE / 2, y - 4, '#2fd96a', 0.85 + Math.sin(t * 3) * 0.15);
		}
		return;
	}
	if (prop.kind === 'stairs') {
		for (let i = 0; i < 5; i++) {
			ctx.fillStyle = i % 2 ? '#b6b9c1' : '#d0d3d9';
			ctx.fillRect(x + 1, y + 1 + i * 3, TILE * 2 - 2, 3);
		}
		ctx.fillStyle = '#d64535'; ctx.fillRect(x, y, 1, TILE); ctx.fillRect(x + TILE * 2 - 1, y, 1, TILE);
		label(ctx, 'EXIT', x + TILE, y - 6, '#2fd96a', 0.85 + Math.sin(t * 3) * 0.15);
	} else {
		ctx.fillStyle = '#6b727c'; ctx.fillRect(x, y, TILE * 2, TILE);
		ctx.fillStyle = '#b9c0c8';
		ctx.fillRect(x + 2, y + 1, TILE - 3, TILE - 2);
		ctx.fillRect(x + TILE + 1, y + 1, TILE - 3, TILE - 2);
		ctx.fillStyle = '#dde2e7';
		ctx.fillRect(x + 2, y + 1, TILE - 3, 1);
		ctx.fillRect(x + TILE + 1, y + 1, TILE - 3, 1);
		label(ctx, 'LIFT', x + TILE, y - 6, '#ffb020', 0.85 + Math.sin(t * 2) * 0.15);
		if (bossGate) {
			ctx.save();
			ctx.globalAlpha = 0.75 + Math.sin(t * 3) * 0.25;
			ctx.strokeStyle = '#ff3b4e';
			ctx.lineWidth = 1;
			ctx.strokeRect(x + 0.5, y + 0.5, TILE * 2 - 1, TILE - 1);
			ctx.restore();
			label(ctx, 'BOSS GATE', x + TILE, y + TILE + 8, '#ff6b7a');
		}
	}
}

function drawActor(ctx: CanvasRenderingContext2D, actor: Actor, cam: Camera, t: number) {
	const x = Math.round(actor.x - cam.x), y = Math.round(actor.y - cam.y);
	if (actor.orb) {
		const pulse = 0.8 + Math.sin(performance.now() / 320 + actor.x) * 0.2;
		const cy = y - 12 - (actor.bob ?? 0);
		ctx.save();
		ctx.globalAlpha = (actor.alpha ?? 1) * pulse;
		ctx.shadowBlur = 14;
		if (actor.skin === 'fire') {
			ctx.shadowColor = '#ff7a18';
			if (actor.orbSprite?.complete && actor.orbSprite.width) {
				// Nearest-neighbour draw keeps every pixel crisp at the 80% zoom.
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(
					actor.orbSprite,
					Math.round(x - actor.orbSprite.width / 2),
					Math.round(cy - actor.orbSprite.height / 2)
				);
			} else {
				// Fallback until the sprite loads: the original vector flame.
				ctx.fillStyle = '#ff3b0d';
				ctx.beginPath();
				ctx.moveTo(x, cy - 9);
				ctx.quadraticCurveTo(x + 7, cy - 1, x + 4, cy + 6);
				ctx.quadraticCurveTo(x, cy + 10, x - 4, cy + 6);
				ctx.quadraticCurveTo(x - 7, cy - 1, x, cy - 9);
				ctx.fill();
				ctx.fillStyle = '#ffd166';
				ctx.beginPath();
				ctx.moveTo(x, cy - 3);
				ctx.quadraticCurveTo(x + 3, cy + 2, x, cy + 6);
				ctx.quadraticCurveTo(x - 3, cy + 2, x, cy - 3);
				ctx.fill();
			}
		} else if (actor.skin === 'water') {
			ctx.shadowColor = '#3ab4ff';
			ctx.fillStyle = '#1d7fe0';
			ctx.beginPath();
			ctx.arc(x, cy + 1, 6, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#7ef9ff';
			ctx.beginPath();
			ctx.arc(x - 2, cy - 1, 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = '#bff4ff';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, cy + 1, 9 + Math.sin(performance.now() / 400) * 1.5, 0, Math.PI * 2);
			ctx.stroke();
		} else {
			ctx.fillStyle = actor.orb;
			ctx.shadowColor = actor.orb;
			ctx.beginPath();
			ctx.arc(x, cy, 5, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.shadowBlur = 0;
		label(ctx, 'SPECTATOR', x, y - 26, actor.skin === 'water' ? '#7ef9ff' : actor.skin === 'fire' ? '#ffb347' : actor.orb);
		ctx.restore();
		return;
	}
	if (!actor.ghost) ellipse(ctx, x, y, 6, 2, C.shadow);
	if (!actor.img || !actor.img.complete || !actor.img.width) return;
	const width = actor.img.width, height = actor.img.height;
	if (actor.ghost) {
		ctx.save();
		ctx.globalAlpha = actor.alpha ?? 0.5;
		ctx.drawImage(silhouette(actor.img, actor.ghost), Math.round(x - width / 2), y - height);
		ctx.restore();
		return;
	}
	ctx.save();
	ctx.globalAlpha = actor.alpha ?? 1;
	const gait = actor.gait ?? t * 6;
	const bounce = actor.sprint
		? -1 - Math.round(Math.abs(Math.sin(gait * 14)) * 2)
		: actor.bob ?? 0;
	if (actor.sprint) {
		const dirX = actor.dirX ?? 0, dirY = actor.dirY ?? 0;
		// Dust puffs and two faded copies sell the run without an extra sprite sheet.
		for (let i = 0; i < 3; i += 1) {
			const phase = (((gait * 3.4 + i / 3) % 1) + 1) % 1;
			ctx.save();
			ctx.globalAlpha = (actor.alpha ?? 1) * (1 - phase) * 0.45;
			ellipse(
				ctx,
				x - dirX * (4 + phase * 11),
				y - dirY * (phase * 5) + 1,
				2 + phase * 3,
				1 + phase * 1.4,
				'#e4dccb'
			);
			ctx.restore();
		}
		for (let i = 2; i >= 1; i -= 1) {
			ctx.save();
			ctx.globalAlpha = (actor.alpha ?? 1) * (0.22 - i * 0.07);
			const ax = x - dirX * i * 4;
			const ay = y - dirY * i * 3;
			if (actor.flip) {
				ctx.translate(ax, 0);
				ctx.scale(-1, 1);
				ctx.drawImage(actor.img, Math.round(-width / 2), ay - height + bounce);
			} else {
				ctx.drawImage(actor.img, Math.round(ax - width / 2), ay - height + bounce);
			}
			ctx.restore();
		}
		ctx.translate(x, y);
		ctx.rotate(dirX * 0.1);
		ctx.scale(1, 0.94 + Math.abs(Math.sin(gait * 14)) * 0.09);
		ctx.translate(-x, -y);
	}
	if (actor.flip) {
		ctx.translate(x, 0);
		ctx.scale(-1, 1);
		ctx.drawImage(actor.img, Math.round(-width / 2), y - height + bounce);
	} else {
		ctx.drawImage(actor.img, Math.round(x - width / 2), y - height + bounce);
	}
	ctx.restore();
	if (actor.name) label(ctx, actor.name, x, y - height - 4, actor.nameColor ?? '#ffffff');
}

export function renderFloor(
	ctx: CanvasRenderingContext2D,
	map: FloorMap,
	cam: Camera,
	view: Viewport,
	actors: Actor[],
	t: number,
	st: RenderState
) {
	if (st.background?.complete && st.background.width) {
		// The 320x180 backroom image from the earlier prototype, stretched to the view.
		ctx.drawImage(st.background, 0, 0, view.w, view.h);
	} else {
		ctx.fillStyle = '#9ea2ab';
		ctx.fillRect(0, 0, view.w, view.h);
	}
	const tx0 = Math.floor(cam.x / TILE) - 1, ty0 = Math.floor(cam.y / TILE) - 1;
	const tx1 = Math.ceil((cam.x + view.w) / TILE) + 1;
	const ty1 = Math.ceil((cam.y + view.h + WALL_H) / TILE) + 1;

	for (let ty = ty0; ty <= ty1; ty++)
		for (let tx = tx0; tx <= tx1; tx++) {
			const c = tileAt(map, tx, ty);
			const x = tx * TILE - Math.round(cam.x), y = ty * TILE - Math.round(cam.y);
			if (map.outdoor) {
				if (c !== 'B' && c !== '#') drawOutdoorTile(ctx, c, x, y, tx, ty);
			} else if (!isWall(c)) drawFloorTile(ctx, x, y, tx, ty);
		}
	if (map.outdoor) drawBuilding(ctx, { x: Math.round(cam.x), y: Math.round(cam.y) });
	if (!map.outdoor && st.background?.complete && st.background.width) {
		// Keep the old backroom image visible through the white floor instead of hiding it
		// completely behind the opaque prototype tiles.
		ctx.save();
		ctx.globalAlpha = 0.14;
		ctx.globalCompositeOperation = 'multiply';
		ctx.drawImage(st.background, 0, 0, view.w, view.h);
		ctx.restore();
	}
	for (const prop of map.props)
		if (prop.kind === 'stairs' || prop.kind === 'elevator' || prop.kind === 'door')
			drawTransport(ctx, prop, cam, t, map.outdoor, !!st.bossGate);

	const items: { y: number; draw: () => void }[] = [];
	for (let ty = ty0; ty <= ty1; ty++)
		for (let tx = tx0; tx <= tx1; tx++)
			if (!map.outdoor && ty >= 0 && ty < map.h && tx >= 0 && tx < map.w && isWall(tileAt(map, tx, ty))) {
				const x = tx * TILE - Math.round(cam.x), y = ty * TILE - Math.round(cam.y);
				items.push({ y: (ty + 1) * TILE, draw: () => drawWall(ctx, map, tx, ty, x, y) });
			}
	for (const prop of map.props) {
		if (prop.kind === 'table') items.push({ y: prop.y + 2, draw: () => drawTable(ctx, prop, cam, st, t) });
		else if (prop.kind === 'chair') items.push({ y: prop.y + 1, draw: () => drawChair(ctx, prop, cam) });
		else if (prop.kind === 'tree') items.push({ y: prop.y, draw: () => drawTree(ctx, prop, cam, t) });
	}
	for (const actor of actors) items.push({ y: actor.y, draw: () => drawActor(ctx, actor, cam, t) });
	items.sort((a, b) => a.y - b.y);
	for (const item of items) item.draw();

	const radius = Math.max(view.w, view.h) * 0.62;
	const vignette = ctx.createRadialGradient(
		view.w / 2, view.h / 2, radius * 0.45,
		view.w / 2, view.h / 2, radius
	);
	vignette.addColorStop(0, 'rgba(0,0,0,0)');
	vignette.addColorStop(1, 'rgba(40,50,80,0.14)');
	ctx.fillStyle = vignette;
	ctx.fillRect(0, 0, view.w, view.h);
}
