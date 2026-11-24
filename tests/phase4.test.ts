import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Bun.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'coalition-phase4-'));

const { getStore } = await import('../src/lib/server/db');
const { audit } = await import('../src/lib/server/audit');
const {
	clearDiscordRateLimit,
	discordConfigured,
	formatDiscordMessage,
	sendDiscordEvent
} = await import('../src/lib/server/discord');
const { control } = await import('../src/lib/server/game/control');
const {
	clientMessageSchema,
	parseClientMessage,
	serverMessageSchema
} = await import('../src/lib/shared/protocol');

describe('phase 4 admin infrastructure', () => {
	beforeAll(async () => {
		const store = await getStore();
		await store.replaceQuestions([
			{
				id: 'p4-1',
				category: 'computer',
				question: 'Phase four question?',
				answer: 'secret-answer',
				acceptedAnswers: ['secret-answer'],
				hint: 'hint'
			}
		]);
	});

	test('audit entries are persisted with a timestamp', async () => {
		await audit({ type: 'admin.test', message: 'Phase 4 audit entry', data: { tab: 4 } });
		const logs = await (await getStore()).listLogs(10);
		const entry = logs.find((log) => log.type === 'admin.test');
		expect(entry).toBeDefined();
		expect(entry!.message).toBe('Phase 4 audit entry');
		expect(entry!.data).toEqual({ tab: 4 });
		expect(typeof entry!.at).toBe('number');
	});

	test('question bank survives a store round trip without exposing answers to clients', async () => {
		const store = await getStore();
		const questions = await store.listQuestions();
		expect(questions).toHaveLength(1);
		expect(questions[0].id).toBe('p4-1');
		expect(questions[0].answer).toBe('secret-answer');
		expect(formatDiscordMessage('room.cleared', { text: 'h1 cleared room 1' })).not.toContain(
			'secret-answer'
		);
	});

	test('global orb visibility is stored in game meta and controlled by admin', async () => {
		const store = await getStore();
		expect((await store.getMeta()).orbsHidden).toBe(false);
		await control({ action: 'hideOrbs', hidden: true });
		expect((await store.getMeta()).orbsHidden).toBe(true);
		await control({ action: 'hideOrbs', hidden: false });
		expect((await store.getMeta()).orbsHidden).toBe(false);
		const logs = await store.listLogs(10);
		expect(logs.some((log) => log.type === 'admin.control' && log.message === 'hideOrbs')).toBe(true);
	});

	test('config history records live config changes', async () => {
		const store = await getStore();
		await store.setConfig({ game: { roomCount: 11 } }, 'phase4-test');
		const history = await store.getConfigHistory();
		expect(history.length).toBeGreaterThan(0);
		expect(history.at(-1)!.by).toBe('phase4-test');
		expect(history.at(-1)!.value).toEqual({ game: { roomCount: 11 } });
	});
});

describe('phase 4 Discord notifications', () => {
	test('formatter only describes important events and never includes movement', () => {
		const message = formatDiscordMessage('boss.defeated', {
			house: 'h2',
			text: 'h2 defeated Staff at x30'
		});
		expect(message).toContain('boss.defeated');
		expect(message).toContain('h2');
		expect(message).toContain('x30');
		expect(message).not.toContain('backroom');
		expect(message).not.toContain('spectatorMove');
	});

	test('disabled webhook is a no-op', async () => {
		clearDiscordRateLimit();
		const result = await sendDiscordEvent('game.start', {}, { url: '' });
		expect(result).toEqual({ ok: false, reason: 'disabled' });
		expect(discordConfigured()).toBe(false);
	});

	test('webhook payload and 30-per-minute limit are enforced', async () => {
		clearDiscordRateLimit();
		const calls: RequestInit[] = [];
		const stubFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			calls.push(init ?? {});
			return new Response(null, { status: 204 });
		}) as typeof fetch;
		const options = { url: 'https://example.test/webhook', fetch: stubFetch, now: () => 1_700_000_000_000 };
		for (let index = 0; index < 30; index += 1) {
			const result = await sendDiscordEvent('room.cleared', { text: `clear ${index}` }, options);
			expect(result.ok).toBe(true);
		}
		const limited = await sendDiscordEvent('game.end', {}, options);
		expect(limited).toEqual({ ok: false, reason: 'rate-limited' });
		expect(calls).toHaveLength(30);
		const payload = JSON.parse(String(calls[0].body)) as { content: string };
		expect(payload.content).toContain('room.cleared');
		expect(payload.content).not.toContain('clear 0 secret');
	});

	test('failed sends are reported without throwing', async () => {
		clearDiscordRateLimit();
		const stubFetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		const result = await sendDiscordEvent(
			'admin.action',
			{ text: 'test' },
			{ url: 'https://example.test/webhook', fetch: stubFetch }
		);
		expect(result.ok).toBe(false);
		expect(result.status).toBe(500);
	});
});

describe('phase 4 spectator protocol', () => {
	test('spectator movement and visibility are valid client messages', () => {
		const move = parseClientMessage(
			JSON.stringify({ type: 'spectatorMove', floor: 2, x: 128.5, y: -4 })
		);
		expect(move).toEqual({ type: 'spectatorMove', floor: 2, x: 128.5, y: -4 });
		expect(
			parseClientMessage(JSON.stringify({ type: 'spectatorVisible', visible: false }))
		).toEqual({ type: 'spectatorVisible', visible: false });
		expect(clientMessageSchema.safeParse({ type: 'spectatorMove', floor: 9, x: 1, y: 2 }).success).toBe(
			false
		);
	});

	test('spectator messages cannot carry game mutations', () => {
		const move = parseClientMessage(
			JSON.stringify({ type: 'spectatorMove', floor: 1, x: 1, y: 2, answer: 'secret' })
		);
		expect(move).toEqual({ type: 'spectatorMove', floor: 1, x: 1, y: 2 });
		expect(JSON.stringify(move)).not.toContain('secret');
		const visible = parseClientMessage(
			JSON.stringify({ type: 'spectatorVisible', visible: true, answer: 'secret' })
		);
		expect(visible).toEqual({ type: 'spectatorVisible', visible: true });
		expect(JSON.stringify(visible)).not.toContain('secret');
	});

	test('spectator and orb server messages are typed', () => {
		const welcome = serverMessageSchema.parse({
			type: 'spectator.welcome',
			id: 'orb-1',
			visible: true,
			orbsHidden: false
		});
		expect(welcome.type).toBe('spectator.welcome');
		const orbs = serverMessageSchema.parse({
			type: 'orbs',
			orbs: [{ id: 'orb-1', floor: 1, x: 10, y: 20, visible: true }]
		});
		expect(orbs.type).toBe('orbs');
		expect(
			serverMessageSchema.safeParse({ type: 'orbsHidden', hidden: 'yes' }).success
		).toBe(false);
	});
});
