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
const { code, token } = registered.session;
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
const received: string[] = [];
const socket = new WebSocket(`${wsBase}/ws/play`, { headers: { cookie } } as never);
await new Promise<void>((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('websocket timeout')), 5000);
	socket.onmessage = (event) => {
		received.push(String(event.data));
		if (received.length >= 2) {
			clearTimeout(timer);
			resolve();
		}
	};
	socket.onerror = () => {
		clearTimeout(timer);
		reject(new Error('websocket error'));
	};
});
assert(received.some((m) => m.includes('"type":"welcome"')), 'welcome received');
assert(received.some((m) => m.includes('"type":"state"')), 'saved state received');

// 5. Ping/pong over the typed protocol.
const pong = await new Promise<string>((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('pong timeout')), 3000);
	const original = socket.onmessage;
	socket.onmessage = (event) => {
		original?.call(socket, event);
		const text = String(event.data);
		if (text.includes('"type":"pong"')) {
			clearTimeout(timer);
			resolve(text);
		}
	};
	socket.send(JSON.stringify({ type: 'ping', sentAt: 12345 }));
});
assert(pong.includes('12345'), 'ping/pong works');

// 6. Live config round trip.
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

// 7. Kick revokes the session and closes the socket.
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
