import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Bun.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'coalition-test-'));

const { createMachineSession, assignHouse, acceptMachine, kickMachine, getSessionView, onDisconnect, moveMachine } =
	await import('../src/lib/server/lobby');
const { getStore } = await import('../src/lib/server/db');

describe('lobby lifecycle', () => {
	let code = '';
	let token = '';
	let activeCode = '';
	let activeToken = '';

	beforeAll(async () => {
		const session = await createMachineSession();
		code = session.code;
		token = session.token;
	});

	test('creates a 4-character machine code and provisional session', async () => {
		expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
		const view = await getSessionView(token);
		expect(view?.accepted).toBe(false);
		expect(view?.house).toBeNull();
	});

	test('admin can assign a house and accept the machine', async () => {
		await assignHouse(code, 'h1');
		await acceptMachine(code);
		const view = await getSessionView(token);
		expect(view?.house).toBe('h1');
		expect(view?.accepted).toBe(true);
	});

	test('a house can only have one active client', async () => {
		const second = await createMachineSession();
		await assignHouse(second.code, 'h1');
		await acceptMachine(second.code);
		activeCode = second.code;
		activeToken = second.token;
		expect(await getSessionView(token)).toBeNull();
		expect((await getSessionView(second.token))?.house).toBe('h1');
	});

	test('disconnect during boss resets boss HP to full', async () => {
		const store = await getStore();
		const house = await store.getHouse('h1');
		expect(house).not.toBeNull();
		house!.boss = { active: true, hp: 123, maxHp: 1000 };
		await store.saveHouse(house!);

		const machine = await store.getMachine(activeCode);
		expect(machine).not.toBeNull();
		await onDisconnect(machine!.code);

		expect((await store.getHouse('h1'))?.boss.hp).toBe(1000);
	});

	test('admin can move a session to another machine', async () => {
		const target = await createMachineSession();
		const movedToken = await moveMachine(activeCode, target.code);
		expect(movedToken).toBe(activeToken);
		const view = await getSessionView(activeToken);
		expect(view?.code).toBe(target.code);
		expect(view?.house).toBe('h1');
		expect(view?.accepted).toBe(true);
	});

	test('kick revokes the session', async () => {
		await kickMachine(code);
		expect(await getSessionView(token)).toBeNull();
	});
});
