import type { ServerWebSocket } from 'bun';
import { env } from './config';
import {
	encode,
	parseClientMessage,
	type ClientMessage,
	type ServerMessage
} from './src/lib/shared/protocol';
import { FLOORS, TILE, floorAndPlug, floorForRoom } from './src/lib/shared/map';
import type { HouseId } from './src/lib/shared/types';
import { getStore } from './src/lib/server/db';
import { emptyBoss } from './src/lib/server/db/types';
import { timeLeftMs } from './src/lib/server/game/clock';
import { roomStatuses } from './src/lib/server/game/dungeon';
import {
	activeStart,
	bossList,
	bossTick,
	enterBoss,
	playerAttack,
	resetMessage,
	setBossMode,
	submitBossAnswer,
	submitBossWord,
	swapBossPlayer
} from './src/lib/server/game/boss';
import { interact, submitAnswer } from './src/lib/server/game/play';
import { getSessionView, markConnected, onDisconnect, SESSION_COOKIE } from './src/lib/server/lobby';
import { liveConfig } from './src/lib/server/config';
import {
	allowedOriginsForRequest,
	clampCosmetic,
	createRateLimiter,
	isAllowedOrigin,
	isInternalAuthorized,
	isLocalDevOrigin,
	MAX_WS_MESSAGE_BYTES
} from './src/lib/server/security';

type SocketData = {
	path: string;
	token: string | null;
	code: string | null;
	house: HouseId | null;
	accepted: boolean;
	spectatorId: string | null;
	visible: boolean;
};

type GhostState = { house: HouseId; floor: number; x: number; y: number };
type OrbState = { id: string; floor: number; x: number; y: number; visible: boolean };

type AppFetch = (
	request: Request,
	server: Bun.Server<SocketData>
) => Response | Promise<Response> | undefined;

if (env.mode === 'prod') {
	if (!env.internalSecret) console.warn('[security] INTERNAL_SECRET unset: /internal/* calls are disabled');
	if (env.adminPassword === 'admin') console.warn('[security] ADMIN_PASSWORD is still the default');
	if (env.spectatorKey === 'spectate') console.warn('[security] SPECTATOR_KEY is still the default');
	if (!env.publicOrigin) console.warn('[security] PUBLIC_ORIGIN unset: browser clients must share the server host');
}

const port = env.port;
const allowedOrigins = new Set<string>([
	`http://localhost:${port}`,
	`http://127.0.0.1:${port}`
]);
if (env.publicOrigin) allowedOrigins.add(new URL(env.publicOrigin).origin);
const vitePort = env.mode === 'prod' ? undefined : new URL(env.viteOrigin).port || '80';
if (vitePort) allowedOrigins.add(new URL(env.viteOrigin).origin);
const cosmeticLimiter = createRateLimiter(30, 1000);
const sockets = new Set<ServerWebSocket<SocketData>>();
/** Cosmetic positions only — answers and progress stay server-authoritative. */
const ghostPositions = new Map<HouseId, GhostState>();
/** Spectator orbs are cosmetic and pass through walls; no answers or progress. */
const orbPositions = new Map<string, OrbState>();
/** Cosmetic fire/water skin chosen by each spectator. */
const spectatorSkins = new Map<string, 'fire' | 'water'>();

let appFetch: AppFetch;
if (env.mode === 'prod') {
	const { getHandler } = await import('./build/handler.js');
	appFetch = getHandler().fetch as AppFetch;
} else {
	const devOrigin = new URL(env.viteOrigin);
	appFetch = async (request) => {
		const url = new URL(request.url);
		url.protocol = devOrigin.protocol;
		url.host = devOrigin.host;
		return fetch(new Request(url, request));
	};
}

function cookieValue(header: string | null, name: string): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) return rest.join('=');
	}
	return undefined;
}

function floorForCosmetic(floor: number) {
	return FLOORS.find((item) => item.floor === floor) ?? FLOORS[0];
}

function send(ws: { send(data: string): void }, message: ServerMessage): void {
	ws.send(encode(message));
}

function broadcast(message: ServerMessage): void {
	for (const ws of sockets) {
		if (ws.data.path !== '/ws/spike') send(ws, message);
	}
}

function sendToHouse(house: HouseId, message: ServerMessage): void {
	for (const ws of sockets) {
		if (ws.data.path !== '/ws/spike' && ws.data.house === house) send(ws, message);
	}
}

async function sendScoreboard(): Promise<void> {
	broadcast(await scoreboard());
}

async function sendBossList(house: HouseId): Promise<void> {
	const store = await getStore();
	sendToHouse(house, bossList(await liveConfig(), await store.getHouse(house)));
}

function ghostMessage(): ServerMessage {
	return { type: 'ghosts', houses: [...ghostPositions.values()] };
}

function orbMessage(): ServerMessage {
	return {
		type: 'orbs',
		orbs: [...orbPositions.values()].map((orb) => ({
			...orb,
			skin: spectatorSkins.get(orb.id) ?? 'fire'
		}))
	};
}

function sendToSpectators(message: ServerMessage): void {
	for (const ws of sockets) {
		if (ws.data.path === '/ws/spectate') send(ws, message);
	}
}

function broadcastOrbs(): void {
	// Players must never see spectator orbs; they are cosmetic and spectator-only.
	sendToSpectators(orbMessage());
}

async function shadows(): Promise<ServerMessage> {
	const [store, config] = await Promise.all([getStore(), liveConfig()]);
	const houses = await store.listHouses();
	return {
		type: 'shadows',
		houses: houses.map((house) => ({
			house: house.id,
			room: house.room,
			floor: floorForRoom(house.room),
			plug: ((house.room - 1) % config.game.plugsPerFloor) + 1,
			connected: house.connected
		}))
	};
}

async function scoreboard(): Promise<ServerMessage> {
	const [store, config] = await Promise.all([getStore(), liveConfig()]);
	const [houses, meta, left] = await Promise.all([
		store.listHouses(),
		store.getMeta(),
		timeLeftMs(store)
	]);
	return {
		type: 'scoreboard',
		rows: houses.map((house) => ({
			house: house.id,
			score: house.score,
			room: house.room,
			floor: floorForRoom(house.room),
			plug: ((house.room - 1) % config.game.plugsPerFloor) + 1,
			hp: house.hp
		})),
		timeLeftMs: left,
		paused: meta.paused,
		announcement: meta.announcement,
		open: meta.open === true
	};
}

async function runBossMessage(
	house: HouseId,
	message: Extract<
		ClientMessage,
		{
			type:
				| 'enterBoss'
				| 'leaveBoss'
				| 'typing'
				| 'auditionSubmit'
				| 'bossMode'
				| 'bossSwap'
				| 'bossAttack';
		}
	>
) {
	switch (message.type) {
		case 'enterBoss':
			return enterBoss(house, message.bossId);
		case 'typing':
			return submitBossWord(house, message.word);
		case 'auditionSubmit':
			return submitBossAnswer(house, message.answer);
		case 'bossMode':
			return setBossMode(house, message.mode);
		case 'bossSwap':
			return swapBossPlayer(house);
		case 'bossAttack':
			return playerAttack(house);
		case 'leaveBoss': {
			const store = await getStore();
			const state = await store.getHouse(house);
			if (!state?.boss.active) return { messages: [] };
			state.boss = emptyBoss();
			state.answerLockUntil = null;
			await store.saveHouse(state);
			return {
				messages: [
					{ type: 'boss.end' as const, won: false, score: state.score, bossHp: state.boss.hp, reason: 'left' },
					{ type: 'state' as const, state }
				],
				notice: `${house} left the boss fight`
			};
		}
	}
}

const server = Bun.serve<SocketData>({
	port,
	async fetch(request, bunServer) {
		const url = new URL(request.url);
		const internalAuthorized = () => isInternalAuthorized(request, env.internalSecret);
		const unauthorized = () => new Response('Unauthorized', { status: 401 });

		if (url.pathname.startsWith('/internal/') && !internalAuthorized()) return unauthorized();

		if (url.pathname === '/internal/kick' && request.method === 'POST') {
			const token = url.searchParams.get('token') ?? '';
			for (const ws of sockets) {
				if (ws.data.token === token) ws.close(4001, 'Session revoked');
			}
			return new Response(null, { status: 204 });
		}

		if (url.pathname === '/internal/notice' && request.method === 'POST') {
			const text = (url.searchParams.get('text') ?? '').slice(0, 240);
			if (text) broadcast({ type: 'notice', text });
			return new Response(null, { status: 204 });
		}

		if (url.pathname === '/internal/orbs-hidden' && request.method === 'POST') {
			sendToSpectators({
				type: 'orbsHidden',
				hidden: url.searchParams.get('hidden') === 'true'
			});
			return new Response(null, { status: 204 });
		}

		if (url.pathname === '/internal/refresh' && request.method === 'POST') {
			broadcast(ghostMessage());
			broadcast(await shadows());
			broadcast(await scoreboard());
			return new Response(null, { status: 204 });
		}

		if (
			url.pathname.startsWith('/ws/') &&
			request.headers.get('upgrade')?.toLowerCase() === 'websocket'
		) {
			const requestOrigins = allowedOriginsForRequest(request, allowedOrigins, vitePort);
			const origin = request.headers.get('origin');
			// Dev-only: Vite can auto-pick 5173/5174/5175 when old processes linger.
			if (env.mode !== 'prod' && origin && isLocalDevOrigin(origin)) {
				requestOrigins.add(new URL(origin).origin);
			}
			if (!isAllowedOrigin(origin, requestOrigins)) {
				console.warn(
					`[ws] rejected origin ${origin ?? '(none)'} on ${url.pathname} from ${request.headers.get('host') ?? '(no host)'}`
				);
				return new Response('Forbidden origin', { status: 403 });
			}
			if (url.pathname === '/ws/spike') {
				return bunServer.upgrade(request, {
					data: {
						path: url.pathname,
						token: null,
						code: null,
						house: null,
						accepted: false,
						spectatorId: null,
						visible: false
					}
				})
					? undefined
					: new Response('Upgrade failed', { status: 400 });
			}

			if (url.pathname === '/ws/spectate') {
				const key = url.searchParams.get('key') ?? '';
				if (key !== env.spectatorKey) return new Response('Unauthorized', { status: 401 });
				const id = crypto.randomUUID().slice(0, 8);
				return bunServer.upgrade(request, {
					data: {
						path: url.pathname,
						token: null,
						code: null,
						house: null,
						accepted: true,
						spectatorId: id,
						visible: true
					}
				})
					? undefined
					: new Response('Upgrade failed', { status: 400 });
			}

			const token = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
			const view = await getSessionView(token);
			if (!view) {
				console.warn(`[ws] rejected ${url.pathname}: no valid session cookie`);
				return new Response('Unauthorized', { status: 401 });
			}

			return bunServer.upgrade(request, {
				data: {
					path: url.pathname,
					token: view.token,
					code: view.code,
					house: view.house,
					accepted: view.accepted,
					spectatorId: null,
					visible: false
				}
			})
				? undefined
				: new Response('Upgrade failed', { status: 400 });
		}

		return appFetch(request, bunServer);
	},
	websocket: {
		async open(ws) {
			sockets.add(ws);
			if (ws.data.path === '/ws/spike') {
				ws.send(JSON.stringify({ type: 'spike.hello', path: ws.data.path }));
				return;
			}

			if (ws.data.path === '/ws/spectate' && ws.data.spectatorId) {
				const store = await getStore();
				const meta = await store.getMeta();
				const spawn = FLOORS[0].spawn;
				orbPositions.set(ws.data.spectatorId, {
					id: ws.data.spectatorId,
					floor: 1,
					x: spawn.x,
					y: spawn.y,
					visible: ws.data.visible
				});
				send(ws, {
					type: 'spectator.welcome',
					id: ws.data.spectatorId,
					visible: ws.data.visible,
					orbsHidden: meta.orbsHidden,
					skin: spectatorSkins.get(ws.data.spectatorId) ?? 'fire'
				});
				send(ws, orbMessage());
				send(ws, ghostMessage());
				send(ws, await shadows());
				send(ws, await scoreboard());
				broadcastOrbs();
				return;
			}

			if (ws.data.code) await markConnected(ws.data.code, true);
			send(ws, {
				type: 'welcome',
				sessionId: ws.data.token ?? '',
				code: ws.data.code ?? '',
				house: ws.data.house,
				accepted: ws.data.accepted
			});
			// No orb/orbsHidden messages to players: spectator orbs are invisible to them.
			send(ws, ghostMessage());

			const state = ws.data.house ? await (await getStore()).getHouse(ws.data.house) : null;
			send(ws, bossList(await liveConfig(), state));

			if (ws.data.house) {
				if (state) {
					send(ws, { type: 'state', state });
					send(ws, {
						type: 'dungeon',
						current: state.room,
						...floorAndPlug(state.room),
						rooms: await roomStatuses(state)
					});
					const active = activeStart(state, await liveConfig());
					if (active) send(ws, active);
				}
				send(ws, await scoreboard());
				broadcast(await shadows());
			}
		},
		async message(ws, raw) {
			if (typeof raw === 'string' && raw.length > MAX_WS_MESSAGE_BYTES) {
				send(ws, { type: 'error', code: 'MESSAGE_TOO_LARGE', message: 'Message too large' });
				return;
			}
			if (ws.data.path === '/ws/spike') {
				ws.send(
					JSON.stringify({
						type: 'spike.echo',
						data: typeof raw === 'string' ? raw : '[binary]'
					})
				);
				return;
			}

			const message = parseClientMessage(typeof raw === 'string' ? raw : '');
			if (!message) {
				send(ws, { type: 'error', code: 'BAD_MESSAGE', message: 'Invalid message' });
				return;
			}
			if (message.type === 'ping') {
				send(ws, { type: 'pong', sentAt: message.sentAt });
				return;
			}

			const key = ws.data.spectatorId ?? ws.data.token ?? ws.data.path;
			if (
				(message.type === 'move' ||
					message.type === 'spectatorMove' ||
					message.type === 'spectatorVisible' ||
					message.type === 'spectatorSkin') &&
				!cosmeticLimiter(key)
			) {
				send(ws, { type: 'error', code: 'RATE_LIMITED', message: 'Too many updates' });
				return;
			}

			if (ws.data.path === '/ws/spectate') {
				if (message.type === 'spectatorMove' && ws.data.spectatorId) {
					const target = floorForCosmetic(message.floor);
					orbPositions.set(ws.data.spectatorId, {
						id: ws.data.spectatorId,
						floor: message.floor,
						x: clampCosmetic(message.x, target.w * TILE),
						y: clampCosmetic(message.y, target.h * TILE),
						visible: ws.data.visible
					});
					broadcastOrbs();
					return;
				}
				if (message.type === 'spectatorVisible') {
					ws.data.visible = message.visible;
					const orb = ws.data.spectatorId ? orbPositions.get(ws.data.spectatorId) : null;
					if (orb) orb.visible = message.visible;
					broadcastOrbs();
					return;
				}
				if (message.type === 'spectatorSkin' && ws.data.spectatorId) {
					spectatorSkins.set(ws.data.spectatorId, message.skin);
					broadcastOrbs();
					return;
				}
				send(ws, {
					type: 'error',
					code: 'SPECTATOR_READ_ONLY',
					message: 'Spectators cannot interact with the game'
				});
				return;
			}

			if (!ws.data.house) {
				send(ws, { type: 'error', code: 'NO_HOUSE', message: 'No house assigned' });
				return;
			}

			// Accepted players wait outside until the admin opens the building.
			const gameOpen = (await (await getStore()).getMeta()).open;
			if (
				!gameOpen &&
				(message.type === 'interact' ||
					message.type === 'answer' ||
					message.type === 'enterBoss' ||
					message.type === 'typing' ||
					message.type === 'auditionSubmit' ||
					message.type === 'bossMode' ||
					message.type === 'bossSwap' ||
					message.type === 'bossAttack' ||
					message.type === 'leaveBoss')
			) {
				send(ws, {
					type: 'error',
					code: 'GAME_NOT_OPEN',
					message: 'Waiting for admin to open the game'
				});
				return;
			}

			if (message.type === 'move') {
				const target = floorForCosmetic(message.floor);
				ghostPositions.set(ws.data.house, {
					house: ws.data.house,
					floor: message.floor,
					x: clampCosmetic(message.x, target.w * TILE),
					y: clampCosmetic(message.y, target.h * TILE)
				});
				broadcast(ghostMessage());
				return;
			}

			if (message.type === 'interact') {
				const result = await interact(ws.data.house, message.tableId);
				for (const outgoing of result.messages) send(ws, outgoing);
				if (result.notice) broadcast({ type: 'notice', text: result.notice });
				if (result.progressChanged) {
					broadcast(await shadows());
					broadcast(await scoreboard());
				}
				return;
			}

			if (message.type === 'answer') {
				const result = await submitAnswer(ws.data.house, message.answer, message.roomId);
				for (const outgoing of result.messages) send(ws, outgoing);
				if (result.notice) broadcast({ type: 'notice', text: result.notice });
				if (result.progressChanged) {
					broadcast(await shadows());
					broadcast(await scoreboard());
					await sendBossList(ws.data.house);
				}
				return;
			}

			if (
				message.type === 'enterBoss' ||
				message.type === 'typing' ||
				message.type === 'auditionSubmit' ||
				message.type === 'bossMode' ||
				message.type === 'bossSwap' ||
				message.type === 'bossAttack' ||
				message.type === 'leaveBoss'
			) {
				const result = await runBossMessage(ws.data.house, message);
				for (const outgoing of result.messages) send(ws, outgoing);
				if (result.notice) broadcast({ type: 'notice', text: result.notice });
				if (result.shared) {
					for (const [house, messages] of result.shared) {
						for (const outgoing of messages) sendToHouse(house, outgoing);
						await sendBossList(house);
					}
				}
				if (result.progressChanged) {
					broadcast(await shadows());
					await sendScoreboard();
					await sendBossList(ws.data.house);
				}
				return;
			}

			send(ws, {
				type: 'error',
				code: 'NOT_IMPLEMENTED',
				message: `${message.type} arrives in a later phase`
			});
		},
		async close(ws) {
			sockets.delete(ws);
			if (ws.data.path === '/ws/spectate' && ws.data.spectatorId) {
				orbPositions.delete(ws.data.spectatorId);
				spectatorSkins.delete(ws.data.spectatorId);
				broadcastOrbs();
				return;
			}
			if (ws.data.path !== '/ws/spike' && ws.data.code) {
				const house = ws.data.house;
				const store = await getStore();
				const wasBossActive = house ? (await store.getHouse(house))?.boss.active : false;
				if (house) {
					ghostPositions.delete(house);
					broadcast(ghostMessage());
				}
				await onDisconnect(ws.data.code);
				if (house && wasBossActive) {
					const state = await store.getHouse(house);
					if (state) sendToHouse(house, resetMessage(state, 'disconnect'));
				}
				broadcast(await shadows());
				broadcast(await scoreboard());
			}
		}
	}
});

const bossTimer = setInterval(async () => {
	try {
		const tick = await bossTick();
		for (const [house, messages] of tick.byHouse) {
			for (const message of messages) sendToHouse(house, message);
		}
		if (tick.progressChanged) {
			broadcast(await shadows());
			await sendScoreboard();
			for (const house of tick.byHouse.keys()) await sendBossList(house);
		}
	} catch (error) {
		console.error('[boss] tick failed', error);
	}
}, 250);

// Keep the timer from holding up short-lived test processes.
if (typeof Bun !== 'undefined' && Bun.env.NODE_ENV === 'test') clearInterval(bossTimer);

console.log(`[server] mode=${env.mode} listening on http://localhost:${server.port} (WebSocket on /ws/*)`);
