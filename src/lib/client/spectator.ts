// Read-only spectator client: a light orb that flies through walls and ignores fog.
import { FLOORS, type FloorMap } from '../shared/map';
import type { SpectatorSkin } from '../shared/types';
import { renderFloor, type Actor } from './render';

const BASE_W = 320;
const BASE_H = 180;
const BACKING_SCALE = 2;
const FLY_SPEED = 120;
const ORB_COLORS = ['#7ef9ff', '#ffe680', '#ff9de2', '#a6ff9e', '#c4b5fd', '#ffb27e'];

export type SpectatorOrb = {
	id: string;
	floor: number;
	x: number;
	y: number;
	visible: boolean;
	skin?: SpectatorSkin;
};

export type SpectatorOptions = {
	canvas: HTMLCanvasElement;
	onMove?: (position: { floor: number; x: number; y: number }) => void;
	onSkin?: (skin: SpectatorSkin) => void;
};

function colorFor(id: string): string {
	return ORB_COLORS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % ORB_COLORS.length];
}

export function createSpectator(options: SpectatorOptions) {
	const context = options.canvas.getContext('2d');
	if (!context) throw new Error('Canvas 2D unavailable');
	const ctx: CanvasRenderingContext2D = context;
	const background = new Image();
	background.src = '/sprites/arena.png';

	const keys = new Set<string>();
	const orbs = new Map<string, SpectatorOrb>();
	let floorByNumber = new Map(FLOORS.map((floor) => [floor.floor, floor] as const));
	let map: FloorMap = floorByNumber.get(1) ?? FLOORS[0];
	const pos = { x: map.spawn.x, y: map.spawn.y };
	let sendT = 0;
	let running = true;
	let raf = 0;
	let last = performance.now();
	let t = 0;
	let skin: SpectatorSkin = 'fire';
	let orbsHidden = false;

	function resize() {
		const rect = options.canvas.getBoundingClientRect();
		const cssW = Math.max(1, rect.width || window.innerWidth);
		const cssH = Math.max(1, rect.height || window.innerHeight);
		const width = Math.max(1, Math.round(cssW * BACKING_SCALE));
		const height = Math.max(1, Math.round(cssH * BACKING_SCALE));
		if (options.canvas.width !== width) options.canvas.width = width;
		if (options.canvas.height !== height) options.canvas.height = height;
		const aspect = cssW / cssH;
		const viewW = aspect >= BASE_W / BASE_H ? (BASE_H * aspect) : BASE_W;
		const viewH = aspect >= BASE_W / BASE_H ? BASE_H : BASE_W / aspect;
		ctx.setTransform(width / viewW, 0, 0, height / viewH, 0, 0);
	}

	function setFloor(floor: number) {
		const next = floorByNumber.get(floor);
		if (!next) return;
		map = next;
		pos.x = Math.max(8, Math.min(next.w * 16 - 8, pos.x));
		pos.y = Math.max(8, Math.min(next.h * 16 - 8, pos.y));
	}

	const onKeyDown = (event: KeyboardEvent) => {
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
		const key = event.key.toLowerCase();
		if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) event.preventDefault();
		if (/^[0-5]$/.test(key)) setFloor(Number(key));
		if (key === 'b') {
			const lift = map.props.find((prop) => prop.kind === 'elevator');
			if (lift) {
				pos.x = lift.x;
				pos.y = lift.y + 5;
			}
		}
		if (key === 'z' && skin !== 'fire') {
			skin = 'fire';
			options.onSkin?.(skin);
		}
		if (key === 'x' && skin !== 'water') {
			skin = 'water';
			options.onSkin?.(skin);
		}
		keys.add(key);
	};
	const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
	const onBlur = () => keys.clear();
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);
	window.addEventListener('resize', resize);
	resize();

	const frame = (now: number) => {
		if (!running) return;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		t += dt;

		let dx = 0, dy = 0;
		if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
		if (keys.has('d') || keys.has('arrowright')) dx += 1;
		if (keys.has('w') || keys.has('arrowup')) dy -= 1;
		if (keys.has('s') || keys.has('arrowdown')) dy += 1;
		if (dx || dy) {
			const length = Math.hypot(dx, dy);
			// No collision: spectators pass through walls and props.
			pos.x = Math.max(4, Math.min(map.w * 16 - 4, pos.x + (dx / length) * FLY_SPEED * dt));
			pos.y = Math.max(4, Math.min(map.h * 16 - 4, pos.y + (dy / length) * FLY_SPEED * dt));
		}

		sendT += dt;
		if (sendT >= 0.1) {
			sendT = 0;
			options.onMove?.({ floor: map.floor, x: Math.round(pos.x), y: Math.round(pos.y) });
		}

		const rect = options.canvas.getBoundingClientRect();
		const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
		const view = aspect >= BASE_W / BASE_H
			? { w: BASE_H * aspect, h: BASE_H }
			: { w: BASE_W, h: BASE_W / aspect };
		const cam = {
			x: Math.round(Math.max(0, Math.min(Math.max(0, map.w * 16 - view.w), pos.x - view.w / 2))),
			y: Math.round(Math.max(0, Math.min(Math.max(0, map.h * 16 - view.h), pos.y - 16 - view.h / 2)))
		};
		const actors: Actor[] = [];
		for (const orb of orbs.values()) {
			if (orbsHidden || orb.floor !== map.floor) continue;
			actors.push({
				x: orb.x,
				y: orb.y,
				img: null,
				orb: orb.skin ? (orb.skin === 'fire' ? '#ff7a18' : '#3ab4ff') : colorFor(orb.id),
				skin: orb.skin,
				bob: Math.sin(t * 3 + orb.x) * 3
			});
		}
		actors.push({
			x: pos.x,
			y: pos.y,
			img: null,
			orb: skin === 'fire' ? '#ff7a18' : '#3ab4ff',
			skin,
			bob: Math.sin(t * 4) * 2
		});
		renderFloor(ctx, map, cam, view, actors, t, {
			solved: new Set<string>(),
			near: null,
			highlight: null,
			bossGate: map.floor > 0,
			background
		});
		raf = requestAnimationFrame(frame);
	};
	raf = requestAnimationFrame(frame);

	return {
		destroy() {
			running = false;
			cancelAnimationFrame(raf);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('resize', resize);
		},
		setOrbs(list: SpectatorOrb[]) {
			orbs.clear();
			for (const orb of list) orbs.set(orb.id, orb);
		},
		setSkin(next: SpectatorSkin) {
			skin = next;
		},
		setOrbsHidden(hidden: boolean) {
			orbsHidden = hidden;
		},
		setFloor,
		get running() {
			return running;
		}
	};
}
