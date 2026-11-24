import { beforeAll, describe, expect, test } from 'bun:test';

type Listener = (event: { key: string; target: unknown; preventDefault(): void }) => void;

const listeners = new Map<string, Listener>();
let frame: ((now: number) => void) | null = null;
let hud: { floor: number; plug: number; prompt: string | null; sprinting: boolean } | null = null;
let lastMove: { floor: number; x: number; y: number } | null = null;

const ctx = new Proxy(
	{},
	{
		get(target, property) {
			if (property in target) return (target as Record<string, unknown>)[property as string];
			return () => ({ addColorStop() {} });
		},
		set(target, property, value) {
			(target as Record<string, unknown>)[property as string] = value;
			return true;
		}
	}
) as CanvasRenderingContext2D;
const canvas = {
	width: 0,
	height: 0,
	getContext: () => ctx,
	getBoundingClientRect: () => ({ width: 640, height: 360 })
} as unknown as HTMLCanvasElement;

let createGame: typeof import('../src/lib/client/game').createGame;

beforeAll(async () => {
	const globals = globalThis as unknown as Record<string, unknown>;
	globals.HTMLInputElement = class {};
	globals.HTMLTextAreaElement = class {};
	globals.Image = class {
		width = 16;
		height = 16;
		complete = true;
		src = '';
	};
	globals.window = {
		innerWidth: 640,
		innerHeight: 360,
		addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
		removeEventListener: () => undefined
	};
	globals.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
	globals.requestAnimationFrame = (callback: (now: number) => void) => {
		frame = callback;
		return 1;
	};
	globals.cancelAnimationFrame = () => undefined;
	({ createGame } = await import('../src/lib/client/game'));
});

let simNow = performance.now();
function step(frames: number) {
	for (let index = 0; index < frames; index += 1) {
		simNow += 16;
		frame?.(simNow);
	}
}

function key(type: string, value: string) {
	listeners.get(type)?.({ key: value, target: undefined, preventDefault() {} });
}

describe('client movement', () => {
	test('shift sprints faster and switches the HUD to RUN', () => {
		const game = createGame({
			canvas,
			house: 'h1',
			onHud: (next) => (hud = next),
			onMove: (position) => (lastMove = position)
		});
		const startX = 56;
		key('keydown', 'd');
		step(40);
		expect(hud?.sprinting).toBe(false);
		expect(hud?.prompt).toBeNull();
		const walked = (lastMove?.x ?? startX) - startX;

		key('keydown', 'Shift');
		step(40);
		expect(hud?.sprinting).toBe(true);
		const sprinted = (lastMove?.x ?? startX) - (startX + walked);

		key('keyup', 'Shift');
		key('keyup', 'd');
		step(2);
		expect(hud?.sprinting).toBe(false);
		expect(walked).toBeGreaterThan(0);
		expect(sprinted).toBeGreaterThan(walked);
		game.destroy();
	});
});
