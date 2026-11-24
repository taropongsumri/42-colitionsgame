// Client game loop for the ported prototype map. The player walks the white cluster floors,
// collects the glowing question plugs, and the other houses appear as full-colour teammates.
import {
	FLOORS,
	TILE,
	TOTAL_QUESTION_SLOTS,
	QUESTIONS_PER_FLOOR,
	floorForRoom,
	questionTableIdForRoom,
	type FloorMap,
	type Prop
} from '../shared/map';
import { HOUSES, type HouseId } from '../shared/types';
import { move, transportAt } from './world';
import { renderFloor, type Actor, type Viewport } from './render';

const ANIMALS: Record<HouseId, string> = {
	h1: 'scorpion',
	h2: 'elephant',
	h3: 'octopus'
};

/** The original prototype's camera view, scaled up to fill any browser size. */
const BASE_W = 320;
const BASE_H = 180;
const BACKING_SCALE = 2;
const SPEED = 72; // world pixels per second
const SPRINT_SPEED = 126; // Shift + direction: faster, with a running animation
const PLUG_REACH = 26;
const FADE = 0.18;
const PET_LAG = 0.3;

export interface Hud {
	floor: number;
	plug: number;
	prompt: string | null;
	sprinting: boolean;
}

export interface BossOption {
	id: string;
	floor: number;
	name: string;
	title: string;
	question: string;
	hp: number;
	defeated?: boolean;
}

export interface Ghost {
	house: HouseId;
	floor: number;
	x: number;
	y: number;
}

export type GameOptions = {
	canvas: HTMLCanvasElement;
	house: HouseId;
	onInteract?: (tableId: string) => void;
	onHud?: (hud: Hud) => void;
	onMove?: (position: { floor: number; x: number; y: number }) => void;
	onEnterBoss?: (bossId: string) => void;
};

type Target = { floor: number; x: number; y: number };
type GhostTrack = Ghost & { tx: number; ty: number; seen: number };

function loadImage(src: string): HTMLImageElement {
	const image = new Image();
	image.src = src;
	return image;
}

function floorByNumber(floor: number): FloorMap | undefined {
	return FLOORS.find((item) => item.floor === floor);
}

function floorTarget(floor: number, kind: 'spawn' | 'stairs' | 'door' | 'elevator'): Target | null {
	const map = floorByNumber(floor);
	if (!map) return null;
	if (kind === 'spawn') return { floor, x: map.spawn.x, y: map.spawn.y };
	const prop = map.props.find((item) => item.kind === kind);
	if (!prop) return { floor, x: map.spawn.x, y: map.spawn.y };
	return { floor, x: prop.x, y: prop.y + (map.outdoor ? 14 : 5) };
}

export function createGame(options: GameOptions) {
	const { canvas, house } = options;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas 2D unavailable');
	const ctx: CanvasRenderingContext2D = context;

	const playerImage = loadImage(`/sprites/player_${ANIMALS[house]}.png`);
	const petImage = loadImage(`/sprites/pet_${ANIMALS[house]}.png`);
	// The old prototype's backroom image, used as the backdrop behind the floor.
	const backgroundImage = loadImage('/sprites/arena.png');
	const houseImages = Object.fromEntries(
		(Object.keys(HOUSES) as HouseId[]).map((id) => [id, loadImage(`/sprites/player_${ANIMALS[id]}.png`)])
	) as Record<HouseId, HTMLImageElement>;

	let floorIndex = Math.max(0, FLOORS.findIndex((item) => item.floor === 1));
	let map: FloorMap = FLOORS[floorIndex];
	const pos = { x: map.spawn.x, y: map.spawn.y };
	const pet = { x: pos.x - 14, y: pos.y + 2, flip: false };
	const trail: { t: number; x: number; y: number }[] = [];
	const keys = new Set<string>();
	const ghosts = new Map<HouseId, GhostTrack>();
	const solved = new Set<string>();
	let bossOptions: BossOption[] = [];
	let bossSelected = 0;
	let bossReady = false;
	let bossActive = false;
	let currentFloor = 1;
	let currentPlug = 1;
	let bossRetryAt: number | null = null;

	let currentRoom = 1;
	let highlight: string | null = questionTableIdForRoom(1);
	let nextPlug: string | null = null;
	let near: Prop | null = null;
	let paused = false;
	let running = true;
	let zoom = 0.8;
	let t = 0;
	let walkT = 0;
	let sprinting = false;
	let facing = false;
	let runDir = { x: 1, y: 0 };
	let sendT = 0;
	let interactQueued: 'e' | 'q' | null = null;
	let lastHud = '';
	let fade: { t: number; to: Target; switched: boolean } | null = null;
	let view: Viewport = { w: BASE_W, h: BASE_H };
	let scaleX = 1;
	let scaleY = 1;

	function resize() {
		const rect = canvas.getBoundingClientRect();
		const cssW = Math.max(1, rect.width || window.innerWidth);
		const cssH = Math.max(1, rect.height || window.innerHeight);
		const width = Math.max(1, Math.round(cssW * BACKING_SCALE));
		const height = Math.max(1, Math.round(cssH * BACKING_SCALE));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		const aspect = cssW / cssH;
		const baseAspect = BASE_W / BASE_H;
		// Keep the original 16:9 view at 100%. Wider/taller browsers simply see more world.
		const w = aspect >= baseAspect ? (BASE_H / zoom) * aspect : BASE_W / zoom;
		const h = aspect >= baseAspect ? BASE_H / zoom : (BASE_W / zoom) / aspect;
		view = { w, h };
		scaleX = width / w;
		scaleY = height / h;
		ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
		ctx.imageSmoothingEnabled = false;
	}

	function emitHud(prompt: string | null) {
		const hud = { floor: map.floor, plug: currentPlug, prompt, sprinting };
		const key = JSON.stringify(hud);
		if (key !== lastHud) {
			lastHud = key;
			options.onHud?.(hud);
		}
	}

	function switchFloor(target: Target | null) {
		if (!target || target.floor === map.floor) return;
		fade = { t: 0, to: target, switched: false };
	}

	function nearestPlug(): Prop | null {
		let best: Prop | null = null;
		let bestDistance = PLUG_REACH;
		for (const prop of map.props) {
			if (!prop.roomId) continue;
			const distance = Math.hypot(prop.x - pos.x, (prop.y - pos.y) * 1.4);
			if (distance < bestDistance) {
				best = prop;
				bestDistance = distance;
			}
		}
		return best;
	}

	function update(dt: number) {
		t += dt;
		const ease = Math.min(1, dt * 12);
		for (const ghost of ghosts.values()) {
			ghost.x += (ghost.tx - ghost.x) * ease;
			ghost.y += (ghost.ty - ghost.y) * ease;
		}
		if (fade) {
			fade.t += dt;
			if (!fade.switched && fade.t >= FADE) {
				const next = floorByNumber(fade.to.floor);
				if (next) {
					const index = FLOORS.indexOf(next);
					if (index >= 0) floorIndex = index;
					map = next;
					pos.x = fade.to.x;
					pos.y = fade.to.y;
					pet.x = pos.x - 12;
					pet.y = pos.y + 2;
					trail.length = 0;
				}
				fade.switched = true;
			}
			if (fade.t >= FADE * 2) fade = null;
			interactQueued = null;
			return;
		}

		if (paused) {
			walkT = 0;
			interactQueued = null;
			return;
		}

		let dx = 0;
		let dy = 0;
		if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
		if (keys.has('d') || keys.has('arrowright')) dx += 1;
		if (keys.has('w') || keys.has('arrowup')) dy -= 1;
		if (keys.has('s') || keys.has('arrowdown')) dy += 1;
		if (dx || dy) {
			const length = Math.hypot(dx, dy);
			const speed = keys.has('shift') ? SPRINT_SPEED : SPEED;
			move(map, pos, (dx / length) * speed * dt, (dy / length) * speed * dt);
			if (dx) facing = dx < 0;
			runDir = { x: dx / length, y: dy / length };
			// A faster gait drives the bob, lean, dust and afterimages while sprinting.
			walkT += dt * (speed === SPRINT_SPEED ? 1.9 : 1);
		} else walkT = 0;
		sprinting = keys.has('shift') && walkT > 0;

		trail.push({ t, x: pos.x, y: pos.y });
		while (trail.length > 2 && trail[0].t < t - PET_LAG) trail.shift();
		const petTarget = trail[0];
		const petEase = Math.min(1, dt * 8);
		if (Math.hypot(pos.x - pet.x, pos.y - pet.y) > 14 && petTarget) {
			const nextX = pet.x + (petTarget.x - pet.x) * petEase;
			if (Math.abs(nextX - pet.x) > 0.05) pet.flip = nextX > pet.x;
			pet.x = nextX;
			pet.y += (petTarget.y + 2 - pet.y) * petEase;
		}

		sendT += dt;
		if (sendT >= 0.1) {
			sendT = 0;
			options.onMove?.({ floor: map.floor, x: Math.round(pos.x), y: Math.round(pos.y) });
		}

		const pressed = interactQueued;
		interactQueued = null;
		near = nearestPlug();
		const transport = transportAt(map, pos.x, pos.y);

		if (near?.roomId) {
			const isCurrent = near.roomId === highlight;
			const prompt = !isCurrent
				? 'E · Check this socket'
				: solved.has(near.roomId)
					? 'Cleared ✓ · E to view the question'
					: 'E · Plug in and answer';
			emitHud(prompt);
			if (pressed) options.onInteract?.(near.roomId);
			return;
		}

		if (transport?.kind === 'door') {
			const destination = map.outdoor ? 1 : 0;
			emitHud(map.outdoor ? 'E · Enter the building' : 'E · Go outside');
			if (pressed) switchFloor(floorTarget(destination, 'door'));
			return;
		}

		if (transport?.kind === 'stairs') {
			const maxFloor = Math.max(...FLOORS.map((item) => item.floor));
			const up = map.floor < maxFloor ? floorTarget(map.floor + 1, 'stairs') : null;
			const down = map.floor > 0 ? floorTarget(map.floor - 1, 'stairs') : null;
			emitHud(`E · Stairs up${down ? ' · Q · stairs down' : ''}`);
			if (pressed === 'e' && up) switchFloor(up);
			else if (pressed === 'q' && down) switchFloor(down);
			return;
		}

		if (transport?.kind === 'elevator') {
			const available = bossOptions.filter(
				(boss) => boss.floor === currentFloor && !boss.defeated
			);
			if (!available.length) {
				const defeated = bossOptions.some(
					(boss) => boss.floor === currentFloor && boss.defeated
				);
				emitHud(
					defeated
						? 'Boss defeated · take the stairs up'
						: bossReady
							? 'Lift waiting for boss config'
							: 'Lift locked · clear all six plugs first'
				);
				return;
			}
			if (bossRetryAt && bossRetryAt > Date.now()) {
				const seconds = Math.ceil((bossRetryAt - Date.now()) / 1000);
				emitHud(`Lift recharging · retry in ${seconds}s`);
				return;
			}
			const option = available[bossSelected % available.length];
			emitHud(`E · Fight ${option.name}`);
			if (pressed === 'e' && !bossActive) options.onEnterBoss?.(option.id);
			return;
		}

		emitHud(null);
	}

	function render() {
		const worldWidth = map.w * TILE;
		const worldHeight = map.h * TILE;
		const cam = {
			x: Math.round(Math.max(0, Math.min(Math.max(0, worldWidth - view.w), pos.x - view.w / 2))),
			y: Math.round(Math.max(0, Math.min(Math.max(0, worldHeight - view.h), pos.y - 16 - view.h / 2)))
		};
		const bob = walkT > 0 ? -Math.round(Math.abs(Math.sin(walkT * 12))) : 0;
		const actors: Actor[] = [];
		for (const [id, ghost] of ghosts) {
			if (ghost.floor !== map.floor || performance.now() - ghost.seen > 3000) continue;
			// Full-colour teammate sprites, with a label so each house is easy to spot.
			actors.push({
				x: ghost.x,
				y: ghost.y,
				img: houseImages[id],
				bob: Math.round(Math.sin(t * 5 + id.length)),
				name: HOUSES[id].name,
				nameColor: HOUSES[id].color
			});
		}
		actors.push(
			{
				x: pet.x,
				y: pet.y,
				img: petImage,
				flip: pet.flip,
				bob: Math.round(Math.sin((sprinting ? walkT * 1.4 : t) * 6)),
				sprint: sprinting,
				gait: walkT,
				dirX: runDir.x,
				dirY: runDir.y
			},
			{
				x: pos.x,
				y: pos.y,
				img: playerImage,
				bob,
				flip: facing,
				sprint: sprinting,
				gait: walkT,
				dirX: runDir.x,
				dirY: runDir.y
			}
		);

		renderFloor(ctx, map, cam, view, actors, t, {
			solved,
			near: near?.roomId ?? null,
			highlight,
			next: nextPlug,
			background: backgroundImage
		});

		if (fade) {
			const alpha = fade.t < FADE ? fade.t / FADE : 1 - (fade.t - FADE) / FADE;
			ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, alpha))})`;
			ctx.fillRect(0, 0, view.w, view.h);
		}
	}

	const onKeyDown = (event: KeyboardEvent) => {
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
		const key = event.key.toLowerCase();
		if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) event.preventDefault();
		keys.add(key);
		if ((key === 'e' || key === 'q') && !event.repeat) interactQueued = key;
	};
	const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
	const onBlur = () => keys.clear();

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);
	window.addEventListener('resize', resize);
	const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
	observer?.observe(canvas);
	resize();
	emitHud(null);

	let raf = 0;
	let last = performance.now();
	const frame = (now: number) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		update(dt);
		render();
		raf = requestAnimationFrame(frame);
	};
	raf = requestAnimationFrame(frame);

	if (import.meta.env.DEV) Object.assign(window, { __pos: pos });

	return {
		destroy() {
			running = false;
			cancelAnimationFrame(raf);
			observer?.disconnect();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('resize', resize);
		},
		setRoom(room: number) {
			currentRoom = room;
			currentFloor = floorForRoom(room);
			currentPlug = ((Math.max(1, room) - 1) % QUESTIONS_PER_FLOOR) + 1;
			highlight = room <= TOTAL_QUESTION_SLOTS ? questionTableIdForRoom(room) : null;
			nextPlug = null;
			if (currentFloor !== map.floor) switchFloor(floorTarget(currentFloor, 'stairs'));
		},
		setSolved(ids: Iterable<string>) {
			solved.clear();
			for (const id of ids) solved.add(id);
		},
		setNextPlug(id: string | null) {
			nextPlug = id;
		},
		setPaused(next: boolean) {
			paused = next;
			if (next) {
				keys.clear();
				sprinting = false;
				walkT = 0;
				interactQueued = null;
			}
		},
		setBossOptions(list: BossOption[]) {
			bossOptions = list;
			if (bossSelected >= list.length) bossSelected = 0;
		},
		setBossReady(ready: boolean) {
			bossReady = ready;
		},
		setBossActive(active: boolean) {
			if (bossActive !== active) emitHud(null);
			bossActive = active;
		},
		setBossRetryAt(at: number | null) {
			bossRetryAt = at;
		},
		setGhosts(list: Ghost[]) {
			const now = performance.now();
			for (const ghost of list) {
				if (ghost.house === house) continue;
				const current = ghosts.get(ghost.house);
				if (
					!current ||
					current.floor !== ghost.floor ||
					Math.hypot(current.tx - ghost.x, current.ty - ghost.y) > 64
				) {
					ghosts.set(ghost.house, { ...ghost, tx: ghost.x, ty: ghost.y, seen: now });
				} else {
					current.tx = ghost.x;
					current.ty = ghost.y;
					current.seen = now;
				}
			}
			for (const id of [...ghosts.keys()]) {
				if (!list.some((ghost) => ghost.house === id)) ghosts.delete(id);
			}
		},
		get running() {
			return running;
		}
	};
}
