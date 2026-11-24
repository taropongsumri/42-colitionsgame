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
	timeoutMs = 5000,
	source: Message[] = messages
): Promise<Message> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listeners.delete(check);
			reject(new Error(`timed out waiting for ${type}`));
		}, timeoutMs);
		function check() {
			const found = source.slice(fromIndex).find((m) => m.type === type && predicate(m));
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

// Flush in-flight messages by round-tripping a ping, then inspect the log.
async function flush(socketToFlush: WebSocket, source: Message[]): Promise<void> {
	const sentAt = Date.now() + Math.random();
	const from = source.length;
	socketToFlush.send(JSON.stringify({ type: 'ping', sentAt }));
	await waitForMessage('pong', from, (m) => m.sentAt === sentAt, 5000, source);
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
const { dealAllHouses, questionFor } = await import('../src/lib/server/game/dungeon');
const { realTableFor } = await import('../src/lib/shared/dungeon');
const store = await getStore();
const questions = await store.listQuestions();
assert(questions.length === 90, 'all 90 questions are seeded');
assert(new Set(questions.map((question) => question.id)).size === 90, 'question IDs are unique');
assert(new Set(questions.map((question) => question.question)).size === 90, 'question text is unique');
const categoryCounts = questions.reduce<Record<string, number>>((counts, question) => {
	counts[question.category] = (counts[question.category] ?? 0) + 1;
	return counts;
}, {});
assert(categoryCounts.network === 45, '45 network questions are seeded');
assert(categoryCounts.sport === 15, '15 sport questions are seeded');
assert(categoryCounts.general === 30, '30 general questions are seeded');
assert(
	questions.every((question) => question.acceptedAnswers.includes(question.answer)),
	'canonical answer is always accepted'
);

const house = await store.getHouse('h1');
assert(house !== null, 'h1 house state exists');
house!.room = 1;
house!.solvedRooms = [];
house!.score = 0;
house!.status = 'open';
house!.defeatedBosses = [];
house!.bossRetryAt = null;
house!.boss.active = false;
house!.boss.mode = 'idle';
house!.answerLockUntil = null;
house!.questionOrder = dealAllHouses(questions).h1;
await store.saveHouse(house!);

const question = await questionFor('h1', 1);
assert(question !== null, 'question available for h1 room 1');
assert(realTableFor('h1', 1) === 'f1-r1', 'plug 1 uses the ported map table f1-r1');
assert(realTableFor('h1', 6) === 'f1-r6', 'plug 6 is the last table on floor 1');
assert(realTableFor('h1', 7) === 'f2-r1', 'plug 7 starts floor 2');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'interact', tableId: realTableFor('h1', 1) }));
const asked = await waitForMessage('question', cursor);
assert(asked.room === 1 && asked.floor === 1 && asked.plug === 1, 'floor/plug question received');
assert(asked.prompt === question!.question, 'terminal prompt received');
assert(typeof asked.plugId === 'string' && asked.plugId === 'f1-r1', 'plug id reaches the client');
assert(!JSON.stringify(asked).includes(question!.answer), 'question answers are never sent to players');

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
).json()) as {
	config: {
		game: { floorCount: number; plugsPerFloor: number; bossRetryDelaySeconds: number; durationMinutes: number };
	};
};
assert(configGet.config.game.floorCount === 5, 'five floors are configured');
assert(configGet.config.game.plugsPerFloor === 6, 'six plugs per floor are configured');
assert(configGet.config.game.bossRetryDelaySeconds === 120, 'boss retry delay defaults to 120s');
assert(configGet.config.game.durationMinutes === 90, 'default game duration is 90 minutes');

const put = await fetch(`${base}/api/admin/config`, {
	method: 'PUT',
	headers: adminHeaders,
	body: JSON.stringify({ config: { game: { floorCount: 6 } } })
});
assert(put.ok, 'config saved');
const changed = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as { config: { game: { floorCount: number } } };
assert(changed.config.game.floorCount === 6, 'live config override applied');

const reset = await fetch(`${base}/api/admin/config/reset`, {
	method: 'POST',
	headers: adminHeaders
});
assert(reset.ok, 'config reset');
const restored = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as { config: { game: { floorCount: number } } };
assert(restored.config.game.floorCount === 5, 'defaults restored');

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

// 7c. Phase 4 admin APIs: audit log, question bank and Discord status.
const auditTrigger = await fetch(`${base}/api/admin/control`, {
	method: 'POST',
	headers: adminHeaders,
	body: JSON.stringify({ action: 'announce', text: 'phase4 audit check' })
});
assert(auditTrigger.ok, 'admin action creates an audit entry');
const unauthorizedLogs = await fetch(`${base}/api/admin/logs`);
assert(unauthorizedLogs.status === 401, 'audit log requires admin password');
const logsResponse = await fetch(`${base}/api/admin/logs?limit=50&type=admin.control`, {
	headers: adminHeaders
});
assert(logsResponse.ok, 'admin audit log API responds');
const logData = (await logsResponse.json()) as {
	logs: { type: string; message: string }[];
	configHistory: { by: string }[];
};
assert(logData.logs.some((entry) => entry.type === 'admin.control'), 'audit log contains admin actions');
assert(logData.configHistory.length > 0, 'config history is exposed to admin');

const questionResponse = await fetch(`${base}/api/admin/questions`, { headers: adminHeaders });
assert(questionResponse.ok, 'question bank API responds');
const originalQuestions = ((await questionResponse.json()) as { questions: unknown[] }).questions;
assert(originalQuestions.length === 90, 'question bank lists all seeded questions');
const temporaryQuestions = [{ ...(originalQuestions[0] as object), question: 'Phase 4 temporary question' }];
const savedQuestions = await fetch(`${base}/api/admin/questions`, {
	method: 'PUT',
	headers: adminHeaders,
	body: JSON.stringify({ questions: temporaryQuestions })
});
assert(savedQuestions.ok, 'question bank saves through admin API');
const reloadedQuestions = (await (
	await fetch(`${base}/api/admin/questions`, { headers: adminHeaders })
).json()) as { questions: { question: string }[] };
assert(reloadedQuestions.questions[0].question === 'Phase 4 temporary question', 'question edit round trips');
const restoredQuestions = await fetch(`${base}/api/admin/questions`, {
	method: 'PUT',
	headers: adminHeaders,
	body: JSON.stringify({ questions: originalQuestions })
});
assert(restoredQuestions.ok, 'question bank restored after test');

const discordStatus = (await (
	await fetch(`${base}/api/admin/discord`, { headers: adminHeaders })
).json()) as { configured: boolean; maxPerMinute: number };
assert(discordStatus.maxPerMinute === 30, 'Discord rate limit is reported to admin');
assert(discordStatus.configured === false, 'Discord is optional and disabled by default');
const discordTest = (await (
	await fetch(`${base}/api/admin/discord`, {
		method: 'POST',
		headers: adminHeaders,
		body: JSON.stringify({ test: true })
	})
).json()) as { ok: boolean; reason?: string };
assert(discordTest.ok === false && discordTest.reason === 'disabled', 'Discord test reports disabled webhook');

// 7d. Spectators are read-only, skinned orbs that only other spectators see.
const badKey = await fetch(`${base}/ws/spectate?key=wrong-key`, {
	headers: { upgrade: 'websocket' }
}).catch(() => null);
assert(badKey?.status === 401, 'spectator key gate rejects an invalid key');

const spectatorMessages: Message[] = [];
const otherSpectatorMessages: Message[] = [];
const spectatorSocket = new WebSocket(`${wsBase}/ws/spectate?key=spectate`);
let spectatorStatus = 'connecting';
function watchSpectator(target: WebSocket, source: Message[]) {
	target.onmessage = (event) => {
		source.push(JSON.parse(String(event.data)) as Message);
		for (const listener of listeners) listener();
	};
	target.onopen = () => (spectatorStatus = 'open');
	target.onerror = () => (spectatorStatus = 'error');
}
watchSpectator(spectatorSocket, spectatorMessages);
const spectatorWelcome = await waitForMessage(
	'spectator.welcome',
	0,
	(m) => typeof m.id === 'string' && m.id.length > 0,
	5000,
	spectatorMessages
);
assert(spectatorStatus === 'open', 'spectator websocket opened with the correct key');
assert(
	spectatorWelcome.visible === true && spectatorWelcome.orbsHidden === false,
	'spectator orb starts visible'
);
assert(spectatorWelcome.skin === 'fire', 'spectator orb defaults to the fire skin');
const orbId = String(spectatorWelcome.id);

cursor = messages.length;
spectatorSocket.send(JSON.stringify({ type: 'spectatorMove', floor: 2, x: 150, y: 88 }));
await flush(socket, messages);
assert(
	!messages.slice(cursor).some((message) => message.type === 'orbs'),
	'players never receive spectator orb messages'
);
const spectatorSeenBySelf = await waitForMessage(
	'orbs',
	0,
	(m) => m.orbs?.some((orb: any) => orb.id === orbId && orb.floor === 2 && orb.x === 150),
	5000,
	spectatorMessages
);
assert(spectatorSeenBySelf.orbs.some((orb: any) => orb.id === orbId), 'spectator receives its own orb');

// A second spectator proves orbs are shared with spectators but not players.
const otherSpectatorSocket = new WebSocket(`${wsBase}/ws/spectate?key=spectate`);
watchSpectator(otherSpectatorSocket, otherSpectatorMessages);
const otherWelcome = await waitForMessage(
	'spectator.welcome',
	0,
	(m) => typeof m.id === 'string' && m.id.length > 0,
	5000,
	otherSpectatorMessages
);
const otherOrbId = String(otherWelcome.id);
assert(otherOrbId !== orbId, 'each spectator gets a unique orb id');
await waitForMessage(
	'orbs',
	0,
	(m) => m.orbs?.some((orb: any) => orb.id === orbId) && m.orbs?.some((orb: any) => orb.id === otherOrbId),
	5000,
	spectatorMessages
);
assert(true, 'spectators see each other flying through the backrooms');

spectatorSocket.send(JSON.stringify({ type: 'spectatorSkin', skin: 'water' }));
await waitForMessage(
	'orbs',
	0,
	(m) => m.orbs?.some((orb: any) => orb.id === orbId && orb.skin === 'water'),
	5000,
	otherSpectatorMessages
);
assert(true, 'fire/water orb skins are broadcast to other spectators');

spectatorSocket.send(JSON.stringify({ type: 'spectatorVisible', visible: false }));
await waitForMessage(
	'orbs',
	0,
	(m) => m.orbs?.some((orb: any) => orb.id === orbId && orb.visible === false),
	5000,
	otherSpectatorMessages
);
assert(true, 'orb visibility toggle is broadcast between spectators');
spectatorSocket.send(JSON.stringify({ type: 'spectatorVisible', visible: true }));
await waitForMessage(
	'orbs',
	0,
	(m) => m.orbs?.some((orb: any) => orb.id === orbId && orb.visible === true),
	5000,
	otherSpectatorMessages
);
assert(true, 'spectator can show its orb again');

const roomBeforeSpectatorAnswer = (await store.getHouse('h1'))!.room;
spectatorSocket.send(JSON.stringify({ type: 'answer', roomId: 'r1', answer: 'anything' }));
const readOnly = await waitForMessage(
	'error',
	0,
	(m) => m.code === 'SPECTATOR_READ_ONLY',
	5000,
	spectatorMessages
);
assert(readOnly.code === 'SPECTATOR_READ_ONLY', 'spectators cannot submit answers');
assert(
	(await store.getHouse('h1'))!.room === roomBeforeSpectatorAnswer,
	'spectator messages never change progress'
);

const hideOrbs = await fetch(`${base}/api/admin/control`, {
	method: 'POST',
	headers: adminHeaders,
	body: JSON.stringify({ action: 'hideOrbs', hidden: true })
});
assert(hideOrbs.ok, 'admin can globally hide spectator orbs');
await waitForMessage('orbsHidden', 0, (m) => m.hidden === true, 5000, spectatorMessages);
assert(true, 'global orb hide reaches spectators');

const showOrbs = await fetch(`${base}/api/admin/control`, {
	method: 'POST',
	headers: adminHeaders,
	body: JSON.stringify({ action: 'hideOrbs', hidden: false })
});
assert(showOrbs.ok, 'admin can restore spectator orbs');
await waitForMessage('orbsHidden', 0, (m) => m.hidden === false, 5000, spectatorMessages);
assert((await store.getMeta()).orbsHidden === false, 'global orb visibility restored in store');

otherSpectatorSocket.close();
await waitForMessage(
	'orbs',
	0,
	(m) => Array.isArray(m.orbs) && m.orbs.length === 1 && m.orbs[0].id === orbId,
	5000,
	spectatorMessages
);
assert(true, 'spectator orb disappears when that spectator leaves');
spectatorSocket.close();

// 7b. Boss phase: one boss per floor, full heal, server-owned answers, retry gate.
const bossConfig = (await (
	await fetch(`${base}/api/admin/config`, { headers: adminHeaders })
).json()) as {
	config: {
		boss: {
			bosses: {
				id: string;
				floor: number;
				name: string;
				hp: number;
				answers: string[];
				showNextWords: boolean;
				comboBreakEvery: number;
				comboBreakPercent: number;
				comboBreakStackPercent: number;
			}[];
		};
	};
};
assert(bossConfig.config.boss.bosses.length === 5, 'five floor bosses are configured');
assert(
	bossConfig.config.boss.bosses.map((boss) => boss.floor).join(',') === '1,2,3,4,5',
	'every floor has its own boss'
);
assert(
	bossConfig.config.boss.bosses.every((boss) => boss.answers.length > 0),
	'boss answers stay in server config'
);
const configuredBoss = bossConfig.config.boss.bosses[0];
assert(configuredBoss.showNextWords === true, 'next-word preview is restored after config reset');

const bossHouse = (await store.getHouse('h1'))!;
bossHouse.room = 6;
bossHouse.solvedRooms = Array.from({ length: 6 }, (_, index) => index + 1);
bossHouse.status = 'boss';
bossHouse.defeatedBosses = [];
bossHouse.bossRetryAt = null;
bossHouse.boss.active = false;
bossHouse.answerLockUntil = null;
await store.saveHouse(bossHouse);

cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: configuredBoss.id }));
const bossStart = await waitForMessage('boss.start', cursor);
assert(bossStart.boss?.id === configuredBoss.id, 'boss fight started from the floor 1 lift');
assert(bossStart.hp === configuredBoss.hp && bossStart.maxHp === configuredBoss.hp, 'boss starts at full HP');
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
assert(defeatedHouse.room === 7, 'floor 1 boss win opens floor 2 plug 1');
assert(defeatedHouse.defeatedBosses.includes(configuredBoss.id), 'defeated boss is recorded on the house');
await waitForMessage(
	'boss.list',
	0,
	(m) => m.bosses?.some((boss: any) => boss.id === configuredBoss.id && boss.defeated === true),
	5000
);
assert(true, 'boss list marks the floor 1 boss as defeated');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: configuredBoss.id }));
const defeatedError = await waitForMessage('error', cursor, (m) => m.code === 'BOSS_DEFEATED');
assert(defeatedError.code === 'BOSS_DEFEATED', 'a defeated boss cannot be fought again');

// Floor 2: admin can open the next lift, and its boss is a different fight.
const forceBoss = await fetch(`${base}/api/admin/control`, {
	method: 'POST',
	headers: adminHeaders,
	body: JSON.stringify({ action: 'forceBoss', house: 'h1' })
});
assert(forceBoss.ok, 'admin can open the current floor lift');
const floorTwoBoss = bossConfig.config.boss.bosses.find((boss) => boss.floor === 2)!;
assert(!!floorTwoBoss, 'floor 2 boss exists');
cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: floorTwoBoss.id }));
const secondStart = await waitForMessage('boss.start', cursor);
assert(secondStart.boss?.id === floorTwoBoss.id, 'floor 2 boss starts from its own lift');
assert(
	secondStart.hp === floorTwoBoss.hp && secondStart.maxHp === floorTwoBoss.hp,
	'every fight starts with a full boss HP bar'
);
assert(!JSON.stringify(secondStart).includes(floorTwoBoss.answers[0]), 'floor 2 secret answer stays server-side');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'auditionSubmit', answer: 'definitely-wrong' }));
const bossDenied = await waitForMessage('boss.answerResult', cursor);
assert(bossDenied.correct === false, 'wrong boss answer is rejected');
const afterDenied = (await store.getHouse('h1'))!;
afterDenied.boss.lockUntil = null;
afterDenied.answerLockUntil = null;
await store.saveHouse(afterDenied);

cursor = messages.length;
socket.send(JSON.stringify({ type: 'auditionSubmit', answer: floorTwoBoss.answers[0] }));
const audition = await waitForMessage('boss.audition', cursor);
assert(audition.length > 0, 'correct boss answer starts a timed audition');

// Knockout sets a server-enforced retry delay, which admin can clear.
const fighting = (await store.getHouse('h1'))!;
fighting.boss.mode = 'typing';
fighting.boss.audition = null;
fighting.boss.playerHp = 1;
fighting.boss.attackAt = 0;
await store.saveHouse(fighting);
await waitForMessage('boss.stun', 0, () => true, 5000);
const stunned = (await store.getHouse('h1'))!;
stunned.boss.stunUntil = Date.now() - 1;
await store.saveHouse(stunned);
const knockout = await waitForMessage('boss.end', 0, (m) => m.reason === 'knockout', 5000);
assert(knockout.retryAt > Date.now(), 'knockout schedules a future retry time');
assert((await store.getHouse('h1'))!.status === 'boss', 'knocked-out house waits at the boss lift');

cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: floorTwoBoss.id }));
const retryError = await waitForMessage('error', cursor, (m) => m.code === 'BOSS_RETRY');
assert(retryError.code === 'BOSS_RETRY', 'server blocks retries until the delay expires');

const clearRetry = await fetch(`${base}/api/admin/control`, {
	method: 'POST',
	headers: adminHeaders,
	body: JSON.stringify({ action: 'clearBossRetry', house: 'h1' })
});
assert(clearRetry.ok, 'admin can clear a boss retry delay');
cursor = messages.length;
socket.send(JSON.stringify({ type: 'enterBoss', bossId: floorTwoBoss.id }));
const retryStart = await waitForMessage('boss.start', cursor);
assert(retryStart.boss?.id === floorTwoBoss.id, 'boss can be re-entered after admin clears the delay');
assert(
	retryStart.hp === floorTwoBoss.hp && retryStart.maxHp === floorTwoBoss.hp,
	'boss HP is fully healed on the retry attempt'
);

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
