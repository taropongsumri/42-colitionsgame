import { HOUSE_IDS, type HouseId } from '../shared/types';
import { getStore, type Store } from './db';
import type { HouseState, Machine, Session } from './db/types';

export const SESSION_COOKIE = 'coalition_session';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(taken: readonly string[]): string {
	let code = '';
	do {
		code = Array.from({ length: 4 }, () =>
			CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
		).join('');
	} while (taken.includes(code));
	return code;
}

async function ensureHouses(store: Store): Promise<void> {
	for (const id of HOUSE_IDS) {
		if (!(await store.getHouse(id))) {
			const house: HouseState = {
				id,
				room: 1,
				status: 'open',
				hp: 100,
				score: 0,
				boss: { active: false, hp: 1000, maxHp: 1000 },
				answerLockUntil: null,
				adjustmentCount: 0,
				connected: false
			};
			await store.saveHouse(house);
		}
	}
}

/** A brand-new browser gets a machine code and a provisional cookie session. */
export async function createMachineSession(): Promise<{ code: string; token: string }> {
	const store = await getStore();
	await ensureHouses(store);
	const machines = await store.listMachines();
	const code = generateCode(machines.map((m) => m.code));
	const token = crypto.randomUUID();

	const machine: Machine = {
		code,
		houseId: null,
		accepted: false,
		sessionToken: token,
		createdAt: Date.now(),
		connected: false,
		lastSeen: null
	};
	const session: Session = {
		token,
		machineCode: code,
		houseId: null,
		createdAt: Date.now(),
		revoked: false
	};

	await store.saveMachine(machine);
	await store.saveSession(session);
	await store.appendLog({
		at: Date.now(),
		type: 'machine.created',
		message: `Machine ${code} registered`
	});

	return { code, token };
}

export interface SessionView {
	token: string;
	code: string;
	house: HouseId | null;
	accepted: boolean;
	connected: boolean;
}

export async function getSessionView(token: string | undefined): Promise<SessionView | null> {
	if (!token) return null;
	const store = await getStore();
	const session = await store.getSession(token);
	if (!session || session.revoked) return null;
	const machine = await store.getMachine(session.machineCode);
	if (!machine) return null;
	return {
		token,
		code: machine.code,
		house: machine.houseId,
		accepted: machine.accepted,
		connected: machine.connected
	};
}

export async function assignHouse(code: string, house: HouseId): Promise<void> {
	const store = await getStore();
	const machine = await store.getMachine(code);
	if (!machine) throw new Error(`Unknown machine: ${code}`);

	// One active client per house: displace any previous occupant.
	for (const other of await store.listMachines()) {
		if (other.code !== code && other.houseId === house && other.accepted) {
			await revoke(store, other);
			await store.appendLog({
				at: Date.now(),
				type: 'machine.displaced',
				house,
				message: `Machine ${other.code} was displaced by ${code}`
			});
		}
	}

	machine.houseId = house;
	await store.saveMachine(machine);
	const session = await store.getSession(machine.sessionToken);
	if (session) {
		session.houseId = house;
		await store.saveSession(session);
	}
}

export async function acceptMachine(code: string): Promise<void> {
	const store = await getStore();
	const machine = await store.getMachine(code);
	if (!machine) throw new Error(`Unknown machine: ${code}`);
	if (!machine.houseId) throw new Error(`Machine ${code} has no house assigned`);

	machine.accepted = true;
	await store.saveMachine(machine);
	const session = await store.getSession(machine.sessionToken);
	if (session) {
		session.houseId = machine.houseId;
		session.revoked = false;
		await store.saveSession(session);
	}
	await store.appendLog({
		at: Date.now(),
		type: 'machine.accepted',
		house: machine.houseId,
		message: `Machine ${code} accepted as ${machine.houseId}`
	});
}

export async function kickMachine(code: string): Promise<string | null> {
	const store = await getStore();
	const machine = await store.getMachine(code);
	if (!machine) return null;
	const token = machine.sessionToken;
	await revoke(store, machine);
	await store.appendLog({
		at: Date.now(),
		type: 'machine.kicked',
		house: machine.houseId ?? undefined,
		message: `Machine ${code} kicked`
	});
	return token;
}

export async function moveMachine(fromCode: string, toCode: string): Promise<string> {
	const store = await getStore();
	const from = await store.getMachine(fromCode);
	const to = await store.getMachine(toCode);
	if (!from || !to) throw new Error('Both machine codes must exist');
	if (!from.houseId) throw new Error(`Machine ${fromCode} has no house to move`);

	const session = await store.getSession(from.sessionToken);
	if (!session) throw new Error('Session not found');

	const houseId = from.houseId;
	await revoke(store, from);
	to.houseId = houseId;
	to.accepted = true;
	to.sessionToken = from.sessionToken;
	await store.saveMachine(to);

	session.machineCode = toCode;
	session.houseId = houseId;
	session.revoked = false;
	await store.saveSession(session);

	await store.appendLog({
		at: Date.now(),
		type: 'machine.moved',
		house: to.houseId,
		message: `Session moved from ${fromCode} to ${toCode}`
	});
	return session.token;
}

export async function markConnected(code: string, connected: boolean): Promise<void> {
	const store = await getStore();
	const machine = await store.getMachine(code);
	if (!machine) return;
	if (!machine.accepted) return;

	machine.connected = connected;
	machine.lastSeen = Date.now();
	await store.saveMachine(machine);

	if (machine.houseId) {
		const house = await store.getHouse(machine.houseId);
		if (house) {
			house.connected = connected;
			await store.saveHouse(house);
		}
	}
}

/** Losing a socket during a boss fight resets the boss to full HP. */
export async function onDisconnect(code: string): Promise<void> {
	const store = await getStore();
	const machine = await store.getMachine(code);
	if (!machine) return;

	machine.connected = false;
	machine.lastSeen = Date.now();
	await store.saveMachine(machine);

	if (!machine.houseId) return;
	const house = await store.getHouse(machine.houseId);
	if (!house) return;

	house.connected = false;
	if (house.boss.active) {
		house.boss.hp = house.boss.maxHp;
		await store.appendLog({
			at: Date.now(),
			type: 'boss.reset',
			house: house.id,
			message: `Boss HP reset after ${code} disconnected`
		});
	}
	await store.saveHouse(house);
}

async function revoke(store: Store, machine: Machine): Promise<void> {
	const session = await store.getSession(machine.sessionToken);
	if (session) {
		session.revoked = true;
		await store.saveSession(session);
	}
	machine.accepted = false;
	machine.houseId = null;
	machine.connected = false;
	await store.saveMachine(machine);
}
