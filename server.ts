import type { ServerWebSocket } from 'bun';
import { env } from './config';
import {
	encode,
	parseClientMessage,
	type ClientMessage,
	type ServerMessage
} from './src/lib/shared/protocol';
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
	resetMessage,
	setBossMode,
	submitBossAnswer,
	submitBossWord,
	swapBossPlayer
} from './src/lib/server/game/boss';
import { interact, submitAnswer } from './src/lib/server/game/play';
import { getSessionView, markConnected, onDisconnect, SESSION_COOKIE } from './src/lib/server/lobby';
import { liveConfig } from './src/lib/server/config';

type SocketData = {
	path: string;
	token: string | null;
	code: string | null;
	house: HouseId | null;
	accepted: boolean;
};

type GhostState = { house: HouseId; floor: number; x: number; y: number };

type AppFetch = (
	request: Request,
	server: Bun.Server<SocketData>
) => Response | Promise<Response> | undefined;

const port = env.port;
const sockets = new Set<ServerWebSocket<SocketData>>();
/** Cosmetic positions only — answers and progress stay server-authoritative. */
const ghostPositions = new Map<HouseId, GhostState>();

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

function ghostMessage(): ServerMessage {
	return { type: 'ghosts', houses: [...ghostPositions.values()] };
}

async function shadows(): Promise<ServerMessage> {
	const store = await getStore();
	const houses = await store.listHouses();
	return {
		type: 'shadows',
		houses: houses.map((house) => ({
			house: house.id,
			room: house.room,
			connected: house.connected
		}))
	};
}

async function scoreboard(): Promise<ServerMessage> {
	const store = await getStore();
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
			hp: house.hp
		})),
		timeLeftMs: left,
		paused: meta.paused,
		announcement: meta.announcement
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
				| 'bossSwap';
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
		case 'leaveBoss': {
			const store = await getStore();
			const state = await store.getHouse(house);
			if (!state?.boss.active) return { messages: [] };
			state.boss = emptyBoss();
			state.answerLockUntil = null;
			await store.saveHouse(state);
			return {
				messages: [
					{ type: 'boss.end' as const, won: false, score: state.score, bossHp: state.boss.hp },
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

		if (url.pathname === '/internal/kick' && request.method === 'POST') {
			const token = url.searchParams.get('token') ?? '';
			for (const ws of sockets) {
				if (ws.data.token === token) ws.close(4001, 'Session revoked');
			}
			return new Response(null, { status: 204 });
		}

		if (url.pathname === '/internal/notice' && request.method === 'POST') {
			broadcast({ type: 'notice', text: url.searchParams.get('text') ?? '' });
			return new Response(null, { status: 204 });
		}

		if (
			url.pathname.startsWith('/ws/') &&
			request.headers.get('upgrade')?.toLowerCase() === 'websocket'
		) {
			if (url.pathname === '/ws/spike') {
				return bunServer.upgrade(request, {
					data: { path: url.pathname, token: null, code: null, house: null, accepted: false }
				})
					? undefined
					: new Response('Upgrade failed', { status: 400 });
			}

			const token = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
			const view = await getSessionView(token);
			if (!view) return new Response('Unauthorized', { status: 401 });

			return bunServer.upgrade(request, {
				data: {
					path: url.pathname,
					token: view.token,
					code: view.code,
					house: view.house,
					accepted: view.accepted
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

			if (ws.data.code) await markConnected(ws.data.code, true);
			send(ws, {
				type: 'welcome',
				sessionId: ws.data.token ?? '',
				code: ws.data.code ?? '',
				house: ws.data.house,
				accepted: ws.data.accepted
			});
			send(ws, ghostMessage());
			send(ws, bossList(await liveConfig()));

			if (ws.data.house) {
				const store = await getStore();
				const state = await store.getHouse(ws.data.house);
				if (state) {
					send(ws, { type: 'state', state });
					send(ws, {
						type: 'dungeon',
						current: state.room,
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

			if (!ws.data.house) {
				send(ws, { type: 'error', code: 'NO_HOUSE', message: 'No house assigned' });
				return;
			}

			if (message.type === 'move') {
				ghostPositions.set(ws.data.house, {
					house: ws.data.house,
					floor: message.floor,
					x: message.x,
					y: message.y
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
				const result = await submitAnswer(ws.data.house, message.answer);
				for (const outgoing of result.messages) send(ws, outgoing);
				if (result.notice) broadcast({ type: 'notice', text: result.notice });
				if (result.progressChanged) {
					broadcast(await shadows());
					broadcast(await scoreboard());
				}
				return;
			}

			if (
				message.type === 'enterBoss' ||
				message.type === 'typing' ||
				message.type === 'auditionSubmit' ||
				message.type === 'bossMode' ||
				message.type === 'bossSwap' ||
				message.type === 'leaveBoss'
			) {
				const result = await runBossMessage(ws.data.house, message);
				for (const outgoing of result.messages) send(ws, outgoing);
				if (result.notice) broadcast({ type: 'notice', text: result.notice });
				if (result.progressChanged) {
					broadcast(await shadows());
					await sendScoreboard();
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
		}
	} catch (error) {
		console.error('[boss] tick failed', error);
	}
}, 250);

// Keep the timer from holding up short-lived test processes.
if (typeof Bun !== 'undefined' && Bun.env.NODE_ENV === 'test') clearInterval(bossTimer);

console.log(`[server] mode=${env.mode} listening on http://localhost:${server.port} (WebSocket on /ws/*)`);
