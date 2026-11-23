import { realTableFor } from '../shared/dungeon';
import { HOUSES, type HouseId } from '../shared/types';

export interface Shadow {
	house: HouseId;
	room: number;
	connected: boolean;
}

interface Sprite {
	image: HTMLImageElement;
	ready: boolean;
}

const WIDTH = 480;
const HEIGHT = 270;
const SCALE = 2;

const TABLES = [
	{ id: 't0', x: 120, y: 145 },
	{ id: 't1', x: 360, y: 145 },
	{ id: 't2', x: 120, y: 220 },
	{ id: 't3', x: 360, y: 220 }
];

const ANIMALS: Record<HouseId, string> = {
	h1: 'scorpion',
	h2: 'elephant',
	h3: 'octopus'
};

function loadSprite(path: string): Sprite {
	const image = new Image();
	const sprite: Sprite = { image, ready: false };
	image.onload = () => (sprite.ready = true);
	image.src = path;
	return sprite;
}

export function createGame(options: {
	canvas: HTMLCanvasElement;
	house: HouseId;
	onInteract: (tableId: string) => void;
}) {
	const { canvas, house, onInteract } = options;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D unavailable');

	canvas.width = WIDTH * SCALE;
	canvas.height = HEIGHT * SCALE;
	ctx.imageSmoothingEnabled = false;
	// Draw in logical 480x270 coordinates; the backing store is 2x for crisp pixels.
	ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

	const playerSprite = loadSprite(`/sprites/player_${ANIMALS[house]}.png`);
	const petSprite = loadSprite(`/sprites/pet_${ANIMALS[house]}.png`);
	const shadowSprites = new Map<HouseId, Sprite>(
		(['h1', 'h2', 'h3'] as HouseId[])
			.filter((id) => id !== house)
			.map((id) => [id, loadSprite(`/sprites/player_${ANIMALS[id]}.png`)] as const)
	);

	const keys = new Set<string>();
	const player = { x: WIDTH / 2, y: 240 };
	const pet = { x: WIDTH / 2 - 30, y: 246 };

	let room = 1;
	let shadows: Shadow[] = [];
	let running = true;
	let frame = 0;

	const onKeyDown = (event: KeyboardEvent) => {
		const key = event.key.toLowerCase();
		keys.add(key);
		if (key === 'e' && !event.repeat && nearRealTable()) {
			onInteract(realTableFor(house, room));
		}
	};
	const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	function nearRealTable(): boolean {
		const table = TABLES.find((item) => item.id === realTableFor(house, room));
		return !!table && Math.hypot(player.x - table.x, player.y - (table.y + 18)) < 58;
	}

	function drawRoom() {
		ctx!.fillStyle = '#e8e4d8';
		ctx!.fillRect(0, 0, WIDTH, HEIGHT);

		// back wall
		ctx!.fillStyle = '#c9c4b6';
		ctx!.fillRect(0, 0, WIDTH, 110);
		ctx!.fillStyle = '#b6b1a3';
		ctx!.fillRect(16, 18, 100, 62);
		ctx!.fillRect(WIDTH - 116, 18, 100, 62);
		ctx!.fillStyle = '#e8e4d8';
		ctx!.fillRect(20, 22, 92, 54);
		ctx!.fillRect(WIDTH - 112, 22, 92, 54);

		// floor tiles
		ctx!.strokeStyle = '#cfc9ba';
		ctx!.lineWidth = 1;
		for (let x = 0; x <= WIDTH; x += 30) {
			ctx!.beginPath();
			ctx!.moveTo(x, 110);
			ctx!.lineTo(x, HEIGHT);
			ctx!.stroke();
		}
		for (let y = 110; y <= HEIGHT; y += 26) {
			ctx!.beginPath();
			ctx!.moveTo(0, y);
			ctx!.lineTo(WIDTH, y);
			ctx!.stroke();
		}

		ctx!.fillStyle = '#7a746b';
		ctx!.font = '10px monospace';
		ctx!.fillText(`ROOM ${String(room).padStart(2, '0')} — FOG OF WAR ON`, 12, 128);
	}

	function drawTables() {
		const real = realTableFor(house, room);
		for (const table of TABLES) {
			const powered = table.id === real;
			ctx!.fillStyle = '#6f6a60';
			ctx!.beginPath();
			ctx!.ellipse(table.x, table.y + 10, 30, 14, 0, 0, Math.PI * 2);
			ctx!.fill();

			ctx!.fillStyle = powered ? '#b8b2a2' : '#9e988b';
			ctx!.beginPath();
			ctx!.ellipse(table.x, table.y, 30, 15, 0, 0, Math.PI * 2);
			ctx!.fill();

			ctx!.strokeStyle = '#7c766b';
			ctx!.beginPath();
			ctx!.moveTo(table.x - 30, table.y);
			ctx!.lineTo(table.x + 30, table.y);
			ctx!.moveTo(table.x, table.y - 15);
			ctx!.lineTo(table.x, table.y + 15);
			ctx!.stroke();

			ctx!.fillStyle = powered ? '#f5d000' : '#3d3a35';
			if (powered) {
				ctx!.shadowColor = '#f5b301';
				ctx!.shadowBlur = 10 + Math.sin(frame / 8) * 4;
			}
			ctx!.beginPath();
			ctx!.arc(table.x, table.y, 4, 0, Math.PI * 2);
			ctx!.fill();
			ctx!.shadowBlur = 0;
		}
	}

	function drawSprite(sprite: Sprite, x: number, y: number, alpha = 1, tint?: string) {
		if (!sprite.ready) return;
		ctx!.save();
		ctx!.globalAlpha = alpha;
		if (tint) {
			ctx!.fillStyle = tint;
			ctx!.fillRect(x - 2, y - sprite.image.height - 2, sprite.image.width + 4, sprite.image.height + 4);
		}
		ctx!.drawImage(
			sprite.image,
			Math.round(x - sprite.image.width / 2),
			Math.round(y - sprite.image.height),
			sprite.image.width,
			sprite.image.height
		);
		ctx!.restore();
	}

	function drawActors() {
		for (const shadow of shadows) {
			if (!shadow.connected || shadow.room !== room || shadow.house === house) continue;
			const positions = [110, 180, 370];
			const index = ['h1', 'h2', 'h3'].indexOf(shadow.house);
			const sprite = shadowSprites.get(shadow.house);
			if (sprite) drawSprite(sprite, positions[index] ?? 240, 200, 0.35, HOUSES[shadow.house].color);
		}

		drawSprite(petSprite, pet.x, pet.y);
		drawSprite(playerSprite, player.x, player.y);

		if (nearRealTable()) {
			ctx!.fillStyle = '#2f2a24';
			ctx!.font = 'bold 11px monospace';
			ctx!.fillText('[E] OPEN TERMINAL', player.x - 52, player.y - 92);
		}
	}

	function loop() {
		if (!running) return;
		frame += 1;

		let dx = 0;
		let dy = 0;
		if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
		if (keys.has('d') || keys.has('arrowright')) dx += 1;
		if (keys.has('w') || keys.has('arrowup')) dy -= 1;
		if (keys.has('s') || keys.has('arrowdown')) dy += 1;
		if (dx || dy) {
			const length = Math.hypot(dx, dy);
			player.x = Math.max(24, Math.min(WIDTH - 24, player.x + (dx / length) * 2));
			player.y = Math.max(130, Math.min(HEIGHT - 18, player.y + (dy / length) * 2));
		}
		pet.x += (player.x - 28 - pet.x) * 0.05;
		pet.y += (player.y + 4 - pet.y) * 0.05;

		drawRoom();
		drawTables();
		drawActors();
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

	return {
		setRoom(next: number) {
			room = next;
		},
		setShadows(next: Shadow[]) {
			shadows = next;
		},
		destroy() {
			running = false;
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		}
	};
}
