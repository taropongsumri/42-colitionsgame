const base = process.env.BASE_URL ?? 'http://localhost:5173';
const wsBase = process.env.WS_URL ?? 'ws://localhost:3000';
const adminHeaders = { 'x-admin-password': 'admin', 'content-type': 'application/json' };

function assert(condition: unknown, label: string) {
	if (!condition) throw new Error(`FAILED: ${label}`);
	console.log(`ok - ${label}`);
}

// 1. Register a machine and capture the session cookie.
const register = await fetch(`${base}/api/session`, { method: 'POST' });
const cookie = register.headers.get('set-cookie')?.split(';')[0] ?? '';
assert(cookie.startsWith('coalition_session='), 'session cookie issued');
const registered = (await register.json()) as { session: { code: string; token: string } };
const { code } = registered.session;
assert(/^[A-HJ-NP-Z2-9]{4}$/.test(code), `machine code ${code}`);

// 2. Admin sees the pending machine, assigns a house, and accepts it.
let lobby = (await (await fetch(`${base}/api/admin/machines`, { headers: adminHeaders })).json()) as {
	machines: { code: string; sessionToken: string }[];
};
assert(lobby.machines.some((m) => m.code === code), 'admin sees pending machine');

const assign = await fetch(`${base}/api/admin/machines/${code}`, {
	method: 'PATCH',
	headers: adminHeaders,
	body: JSON.stringify({ house: 'h1' })
});
assert(assign.ok, 'admin assigned house h1');

const accept = await fetch(`${base}/api/admin/machines/${code}`, {
	method: 'POST',
	headers: adminHeaders
});
assert(accept.ok, 'admin accepted machine');

// 3. Reconnect view shows the house.
const view = (await (
	await fetch(`${base}/api/session`, { headers: { cookie } })
).json()) as { session: { house: string | null; accepted: boolean } };
assert(view.session.house === 'h1' && view.session.accepted, 'session restores house after reload');

// 4. WebSocket handshake uses the cookie and receives welcome + state.
type Message = { type: string; [key: string]: any };
const messages: Message[] = [];
const listeners = new Set<() => void>();
const socket = new WebSocket(`${wsBase}/ws/play`, { headers: { cookie } } as never);

function waitForMessage(
	type: string,
	fromIndex: number,
	predicate: (message: Message) => boolean = () => true,
	timeoutMs = 5000
): Promise<Message> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listeners.delete(check);
			reject(new Error(`timed out waiting for ${type}`));
		}, timeoutMs);
		function check() {
			const found = messages.slice(fromIndex).find((m) => m.type === type && predicate(m));
			if (found) {
				clearTimeout(timer);
				listeners.delete(check);
				resolve(found);
			}
		}
		listeners.add(check);
		check();
	});
}

let socketStatus = 'connecting';
socket.onmessage = (event) => {
	messages.push(JSON.parse(String(event.data)) as Message);
	for (const listener of listeners) listener();
};
socket.onopen = () => (socketStatus = 'open');
socket.onerror = () => (socketStatus = 'error');
socket.onclose = () => (socketStatus = 'closed');
await Promise.all([
	waitForMessage('welcome', 0, (m) => m.house === 'h1' && m.accepted === true),
	waitForMessage('state', 0, (m) => m.state?.id === 'h1')
]);
assert(socketStatus === 'open', 'websocket opened');
assert(messages.some((m) => m.type === 'welcome'), 'welcome received');
assert(messages.some((m) => m.type === 'state'), 'saved state received');

// 5. Ping/pong over the typed protocol.
let cursor = messages.length;
socket.send(JSON.stringify({ type: 'ping', sentAt: 12345 }));
const pong = await waitForMessage('pong', cursor);
assert(pong.sentAt === 12345, 'ping/pong works');

// 6. Phase 2 quiz flow: interact, wrong answer lock, correct answer, scoreboard.
const { getStore } = await import('../src/lib/server/db');
const { questionFor } = await import('../src/lib/server/game/dungeon');
const { realTableFor } = await import('../src/lib/shared/dungeon');
const store = await getStore();
const questions = await store.listQuestions();
assert(questions.length >= 10, 'questions are seeded');

const house = await store.getHouse('h1');
assert(house !== null, 'h1 house state exists');
house!.room = 1;
house!.solvedRooms = [];
house!.score = 0;
house!.answerLockUntil = null;
await store.saveHouse(house!);

const question = await questionFor('h1', 1);
assert(question !== null, 'question available for h1 room 1');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'interact', tableId: realTableFor('h1', 1) }));
const asked = await waitForMessage('question', cursor);
assert(asked.room === 1 && asked.prompt === question!.question, 'terminal question received');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'answer', roomId: 'r1', answer: 'definitely-wrong' }));
const wrong = await waitForMessage('answerResult', cursor);
assert(wrong.correct === false && typeof wrong.lockUntil === 'number', 'wrong answer locks terminal');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'answer', roomId: 'r1', answer: question!.answer }));
const locked = await waitForMessage('answerResult', cursor);
assert(locked.correct === false, 'locked terminal rejects answers');

const lockedHouse = (await store.getHouse('h1'))!;
lockedHouse.answerLockUntil = null;
await store.saveHouse(lockedHouse);

cursor = messages.length;
socket.send(JSON.stringify({ type: 'answer', roomId: 'r1', answer: question!.answer }));
const correct = await waitForMessage('answerResult', cursor);
assert(correct.correct === true, 'correct answer accepted');
const advanced = await waitForMessage(
	'state',
	cursor,
	(m) => m.state?.id === 'h1' && m.state?.room === 2
);
assert(advanced.state.score > 0, 'score increased after clearing room');

const board = (await (await fetch(`${base}/api/scoreboard`)).json()) as {
	rows: { house: string; score: number }[];
};
assert(board.rows.find((row) => row.house === 'h1')?.score > 0, 'scoreboard reflects new score');

// 7. Live config round trip.
const configGet = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as { config: { game: { roomCount: number } } };
assert(configGet.config.game.roomCount === 10, 'default config served');

const put = await fetch(`${base}/api/admin/config`, {
	method: 'PUT',
	headers: adminHeaders,
	body: JSON.stringify({ config: { game: { roomCount: 12 } } })
});
assert(put.ok, 'config saved');
const changed = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as { config: { game: { roomCount: number } } };
assert(changed.config.game.roomCount === 12, 'live config override applied');

const reset = await fetch(`${base}/api/admin/config/reset`, {
	method: 'POST',
	headers: adminHeaders
});
assert(reset.ok, 'config reset');
const restored = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as { config: { game: { roomCount: number } } };
assert(restored.config.game.roomCount === 10, 'defaults restored');

// 8. Kick revokes the session and closes the socket.
const closed = new Promise<void>((resolve) => {
	socket.onclose = () => resolve();
});
const kick = await fetch(`${base}/api/admin/machines/${code}`, {
	method: 'DELETE',
	headers: adminHeaders
});
assert(kick.ok, 'admin kicked machine');
await Promise.race([
	closed,
	new Promise((_, reject) => setTimeout(() => reject(new Error('socket not closed')), 3000))
]);
assert(true, 'kicked socket closed');
const revoked = (await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()) as {
	session: unknown;
};
assert(revoked.session === null, 'kicked session no longer resolves');

console.log('\nE2E passed');
process.exit(0);
