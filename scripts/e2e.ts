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

// 5b. Cosmetic movement is shared as ghost positions (never answers).
cursor = messages.length;
socket.send(JSON.stringify({ type: 'move', floor: 1, x: 120, y: 240 }));
const ghostUpdate = await waitForMessage('ghosts', cursor, (m) =>
	m.houses?.some((ghost: any) => ghost.house === 'h1' && ghost.x === 120 && ghost.y === 240)
);
assert(ghostUpdate.houses.some((ghost: any) => ghost.house === 'h1'), 'move broadcasts ghost position');

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
assert(realTableFor('h1', 1) === 'f1-r1', 'room 1 uses the ported map table f1-r1');
assert(realTableFor('h1', 6) === 'f2-r1', 'room 6 uses floor 2 table f2-r1');

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

// 7a. Per-boss switches survive the live config round trip.
const bossDefaults = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as {
	config: { boss: { bosses: Record<string, unknown>[] } };
};
const defaultBoss = bossDefaults.config.boss.bosses[0];
assert(!!defaultBoss, 'default boss config is available');
assert(
	typeof defaultBoss.showNextWords === 'boolean' && typeof defaultBoss.comboBreakStackPercent === 'number',
	'per-boss combo settings are configured'
);
assert(defaultBoss.showNextWords === true, 'next-word preview is enabled by default');
const toggle = await fetch(`${base}/api/admin/config`, {
	method: 'PUT',
	headers: adminHeaders,
	body: JSON.stringify({
		config: {
			boss: {
				bosses: [{ ...defaultBoss, showNextWords: false, comboBreakStackPercent: 25 }]
			}
		}
	})
});
assert(toggle.ok, 'per-boss settings saved');
const toggledConfig = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as {
	config: { boss: { bosses: { showNextWords: boolean; comboBreakStackPercent: number }[] } };
};
assert(toggledConfig.config.boss.bosses[0].showNextWords === false, 'next-word preview can be disabled per boss');
assert(toggledConfig.config.boss.bosses[0].comboBreakStackPercent === 25, 'combo stack damage can be configured per boss');
const resetBoss = await fetch(`${base}/api/admin/config/reset`, {
	method: 'POST',
	headers: adminHeaders
});
assert(resetBoss.ok, 'config reset after per-boss test');

// 7b. Boss phase: lift unlock, server-owned answers, typing and audition.
const bossConfig = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as {
	config: {
		boss: {
			bosses: {
				id: string;
				answers: string[];
				showNextWords: boolean;
				comboBreakEvery: number;
				comboBreakPercent: number;
				comboBreakStackPercent: number;
			}[];
		};
	};
};
const configuredBoss = bossConfig.config.boss.bosses[0];
assert(!!configuredBoss && configuredBoss.answers.length > 0, 'boss config is available');
assert(configuredBoss.showNextWords === true, 'next-word preview is restored after config reset');

const bossHouse = (await store.getHouse('h1'))!;
bossHouse.room = 11;
bossHouse.solvedRooms = Array.from({ length: 10 }, (_, index) => index + 1);
bossHouse.boss.active = false;
bossHouse.answerLockUntil = null;
await store.saveHouse(bossHouse);

cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: configuredBoss.id }));
const bossStart = await waitForMessage('boss.start', cursor);
assert(bossStart.boss?.id === configuredBoss.id, 'boss fight started from the lift');
assert(!JSON.stringify(bossStart).includes('"answers"'), 'boss answers are never sent to the client');
assert(!JSON.stringify(bossStart).includes(configuredBoss.answers[0]), 'correct answer stays on the server');
assert(bossStart.comboBreakEvery === configuredBoss.comboBreakEvery, 'combo break interval reaches the client');
assert(bossStart.showNextWords === configuredBoss.showNextWords, 'next-word preview setting reaches the client');
const expectedBreakPercent = (tier: number) =>
	configuredBoss.comboBreakPercent + (tier - 1) * configuredBoss.comboBreakStackPercent;

cursor = messages.length;
socket.send(JSON.stringify({ type: 'typing', word: bossStart.words[bossStart.wordIndex] }));
const bossWord = await waitForMessage('boss.word', cursor);
assert(bossWord.correct === true, 'server accepts a validated typing word');
assert(bossWord.combo === 1 && bossWord.chip > 0, 'correct word starts a damaging combo');

// Build a combo, then spend the charged shield with a server-authoritative attack.
for (let step = 1; step <= 2; step += 1) {
	const current = (await store.getHouse('h1'))!;
	const word = current.boss.wordQueue[current.boss.wordIndex];
	cursor = messages.length;
	socket.send(JSON.stringify({ type: 'typing', word }));
	const chained = await waitForMessage('boss.word', cursor, (m) => m.type === 'boss.word' && m.correct === true);
	assert(chained.combo === step + 1, `combo advances to x${step + 1}`);
}

const chargedHouse = (await store.getHouse('h1'))!;
const shieldBeforeAttack = chargedHouse.boss.shield;
assert(shieldBeforeAttack >= bossStart.attackCost, 'typing charged enough shield to attack');
cursor = messages.length;
socket.send(JSON.stringify({ type: 'bossAttack' }));
const attack = await waitForMessage('boss.playerAttack', cursor);
assert(attack.damage > 0 && typeof attack.move === 'string', 'attack deals server-calculated damage');
assert(attack.shield === shieldBeforeAttack - bossStart.attackCost, 'attack spends shield');
const coolingHouse = (await store.getHouse('h1'))!;
assert(coolingHouse.boss.attackReadyAt > Date.now(), 'attack cooldown is stored server-side');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'bossAttack' }));
const cooling = await waitForMessage('boss.playerAttack', cursor);
assert(cooling.reason === 'COOLDOWN' && cooling.damage === 0, 'rapid attacks are rejected by cooldown');

// Typing keeps working past the initial pool, and combo tiers scale their hit.
for (let step = 0; step < bossStart.words.length; step += 1) {
	const current = (await store.getHouse('h1'))!;
	const combo = current.boss.wordCombo + 1;
	const word = current.boss.wordQueue[current.boss.wordIndex];
	cursor = messages.length;
	socket.send(JSON.stringify({ type: 'typing', word }));
	const chained = await waitForMessage('boss.word', cursor, (m) => m.type === 'boss.word' && m.correct === true);
	const isBreak = combo % configuredBoss.comboBreakEvery === 0;
	assert(chained.finisher === isBreak, `combo x${combo} reports finisher=${isBreak}`);
	if (isBreak) {
		const tier = Math.floor(combo / configuredBoss.comboBreakEvery);
		assert(chained.finisherTier === tier, `combo x${combo} is combo-break tier ${tier}`);
		assert(chained.finisherPercent === expectedBreakPercent(tier), `combo x${combo} hits for ${expectedBreakPercent(tier)}%`);
		assert(chained.finisherDamage > 0, `combo x${combo} pierces the chip floor`);
	}
	const after = (await store.getHouse('h1'))!;
	assert(chained.nextWord === after.boss.wordQueue[after.boss.wordIndex], `word ${combo} stays in sync past the pool`);
}

// The third tier finishes the boss without ever sending the secret answer.
const winningCombo = configuredBoss.comboBreakEvery * 3;
for (let step = 0; step < configuredBoss.comboBreakEvery; step += 1) {
	const current = (await store.getHouse('h1'))!;
	const combo = current.boss.wordCombo + 1;
	if (!current.boss.active || combo > winningCombo) break;
	const word = current.boss.wordQueue[current.boss.wordIndex];
	cursor = messages.length;
	socket.send(JSON.stringify({ type: 'typing', word }));
	const finisher = await waitForMessage('boss.word', cursor, (m) => m.type === 'boss.word' && m.correct === true);
	const isBreak = combo % configuredBoss.comboBreakEvery === 0;
	assert(finisher.finisher === isBreak, `combo x${combo} reports finisher=${isBreak}`);
	if (isBreak) {
		const tier = Math.floor(combo / configuredBoss.comboBreakEvery);
		assert(finisher.finisherTier === tier, `winning combo reports tier ${tier}`);
		assert(finisher.finisherPercent === expectedBreakPercent(tier), `winning combo hits for ${expectedBreakPercent(tier)}%`);
		if (combo === winningCombo) {
			const end = await waitForMessage('boss.end', cursor, (m) => m.won === true);
			assert(end.won === true && end.reason === 'win', 'long combo defeats the boss without the secret answer');
			break;
		}
	}
}
const defeatedHouse = (await store.getHouse('h1'))!;
assert(defeatedHouse.boss.active === false, 'boss fight closes after the final combo break');

// Re-enter a fresh fight so the secret-answer/audition path is still covered.
cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: configuredBoss.id }));
const secondStart = await waitForMessage('boss.start', cursor);
assert(secondStart.boss?.id === configuredBoss.id, 'fresh boss starts after a combo win');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'auditionSubmit', answer: 'definitely-wrong' }));
const bossDenied = await waitForMessage('boss.answerResult', cursor);
assert(bossDenied.correct === false, 'wrong boss answer is rejected');
const afterDenied = (await store.getHouse('h1'))!;
afterDenied.boss.lockUntil = null;
afterDenied.answerLockUntil = null;
await store.saveHouse(afterDenied);

cursor = messages.length;
socket.send(JSON.stringify({ type: 'auditionSubmit', answer: configuredBoss.answers[0] }));
const audition = await waitForMessage('boss.audition', cursor);
assert(audition.length > 0, 'correct boss answer starts a timed audition');

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
