/**
 * Server-only config. Never import this file from client code.
 * Secrets come from environment variables; defaults live here.
 */

export const defaults = {
	game: {
		durationMinutes: 90,
		/** Five indoor floors. Each floor has six question plugs and one boss. */
		floorCount: 5,
		plugsPerFloor: 6,
		/** A knocked-out house must wait this long before retrying the same boss. */
		bossRetryDelaySeconds: 120,
		wrongAnswerLockSeconds: 10,
		stunSeconds: 4,
		lockEscalationSeconds: [30, 60, 90, 120, 150],
		bossMaxHp: 1000,
		bossChipFloor: 0.1,
		auditionLockSeconds: 30
	},
	scoring: {
		roomPoints: 100,
		bossPoints: 1000,
		knockoutPenalty: 50,
		orderBonusPercent: [50, 20, 0]
	},
	boss: {
		theme: 'Staff of the Backrooms',
		wordPool: [
			'apple', 'bread', 'chair', 'door', 'engine', 'flower', 'garden', 'hammer',
			'island', 'jacket', 'kite', 'ladder', 'mirror', 'notebook', 'orange', 'pencil',
			'quilt', 'river', 'spoon', 'table', 'umbrella', 'violin', 'water', 'yellow',
			'zebra', 'bottle', 'candle', 'dragon', 'empty', 'forest'
		],
		/** One boss per floor. Add as many entries as you want in /admin. Answers stay server-side. */
		bosses: [
			{
				id: 'staff',
				floor: 1,
				name: 'Staff',
				title: 'STAFF // FLOOR 1',
				question: 'The staff guards the lift. Type the access phrase from the parking lot sign.',
				answers: ['backroom', 'the backroom'],
				wordPool: [
					'cat', 'dog', 'code', 'door', 'room', 'light', 'wall', 'desk',
					'lamp', 'chair', 'red', 'blue', 'box', 'key', 'map', 'run',
					'jump', 'tree', 'sun', 'moon', 'star', 'fish', 'bird', 'cake'
				],
				hp: 1000,
				playerHp: 100,
				shieldPerWord: 10,
				shieldMax: 100,
				chipPerWord: 5,
				chipFloor: 0.1,
				showNextWords: true,
				comboBreakEvery: 10,
				comboBreakPercent: 20,
				comboBreakStackPercent: 10,
				attackEverySeconds: 3,
				attackDamage: 15,
				wrongHealPercent: 30,
				counterDamage: 30,
				bpm: 140,
				stunSeconds: 4,
				stunPenalty: 50,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 150,
				bossHealOnStunPercent: 25,
				invulnAfterStunSeconds: 5,
				swapInvulnSeconds: 2,
				swapCooldownSeconds: 30,
				rankShieldPercent: [60, 80, 100],
				attacks: ['SEGFAULT', 'KO', '-42', 'LEAK', 'BUS ERR', 'NORM ERR', 'TIMEOUT', 'ABORT']
			},
			{
				id: 'janitor',
				floor: 2,
				name: 'Janitor',
				title: 'JANITOR // FLOOR 2',
				question: 'The cleaner mops the infinite white halls. Name the place you are trapped in.',
				answers: ['backrooms', 'the backrooms'],
				wordPool: [
					'mop', 'bucket', 'tile', 'hall', 'lamp', 'buzz', 'floor', 'dust',
					'key', 'door', 'sign', 'lift', 'staff', 'room', 'wall', 'light'
				],
				hp: 1200,
				playerHp: 100,
				shieldPerWord: 12,
				shieldMax: 120,
				chipPerWord: 6,
				chipFloor: 0.1,
				showNextWords: true,
				comboBreakEvery: 10,
				comboBreakPercent: 20,
				comboBreakStackPercent: 10,
				attackEverySeconds: 2.6,
				attackDamage: 18,
				wrongHealPercent: 25,
				counterDamage: 35,
				bpm: 150,
				stunSeconds: 4,
				stunPenalty: 75,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 180,
				bossHealOnStunPercent: 20,
				invulnAfterStunSeconds: 4,
				swapInvulnSeconds: 2,
				swapCooldownSeconds: 25,
				rankShieldPercent: [60, 80, 100],
				attacks: ['MOP SWEEP', 'BUCKET', 'SLIP', 'DRAIN', 'WAX', 'VACUUM']
			},
			{
				id: 'receptionist',
				floor: 3,
				name: 'Receptionist',
				title: 'RECEPTIONIST // FLOOR 3',
				question: 'The receptionist stamps your pass at the front desk. Where are you checking in?',
				answers: ['front desk', 'the front desk', 'reception', 'check-in'],
				wordPool: [
					'form', 'stamp', 'pass', 'desk', 'bell', 'file', 'pen', 'paper',
					'badge', 'queue', 'sign', 'lobby', 'clerk', 'card', 'book', 'clock'
				],
				hp: 1300,
				playerHp: 100,
				shieldPerWord: 12,
				shieldMax: 120,
				chipPerWord: 7,
				chipFloor: 0.1,
				showNextWords: true,
				comboBreakEvery: 10,
				comboBreakPercent: 22,
				comboBreakStackPercent: 10,
				attackEverySeconds: 2.5,
				attackDamage: 19,
				wrongHealPercent: 25,
				counterDamage: 35,
				bpm: 155,
				stunSeconds: 4,
				stunPenalty: 75,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 180,
				bossHealOnStunPercent: 20,
				invulnAfterStunSeconds: 4,
				swapInvulnSeconds: 2,
				swapCooldownSeconds: 25,
				rankShieldPercent: [60, 80, 100],
				attacks: ['STAMP', 'PAPERCUT', 'QUEUE', 'FILE', 'DENIED', 'RESCHEDULE']
			},
			{
				id: 'security',
				floor: 4,
				name: 'Security',
				title: 'SECURITY // FLOOR 4',
				question: 'The guard watches the endless cameras. Name the passage between the rooms.',
				answers: ['corridor', 'the corridor', 'hallway', 'the hallway'],
				wordPool: [
					'camera', 'guard', 'patrol', 'gate', 'sensor', 'alarm', 'badge', 'key',
					'monitor', 'shield', 'vest', 'radio', 'scan', 'log', 'post', 'sector'
				],
				hp: 1400,
				playerHp: 100,
				shieldPerWord: 13,
				shieldMax: 130,
				chipPerWord: 7,
				chipFloor: 0.1,
				showNextWords: true,
				comboBreakEvery: 10,
				comboBreakPercent: 24,
				comboBreakStackPercent: 10,
				attackEverySeconds: 2.3,
				attackDamage: 21,
				wrongHealPercent: 22,
				counterDamage: 40,
				bpm: 160,
				stunSeconds: 4,
				stunPenalty: 80,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 180,
				bossHealOnStunPercent: 18,
				invulnAfterStunSeconds: 4,
				swapInvulnSeconds: 1.5,
				swapCooldownSeconds: 22,
				rankShieldPercent: [60, 80, 100],
				attacks: ['TASER', 'CAMERA', 'PATROL', 'LOCKDOWN', 'SIREN', 'SEARCH']
			},
			{
				id: 'manager',
				floor: 5,
				name: 'Manager',
				title: 'MANAGER // FINAL FLOOR',
				question: 'The manager holds the master key to every floor. What opens the final lift?',
				answers: ['master key', 'the master key', 'key', 'a key'],
				wordPool: [
					'briefcase', 'meeting', 'deadline', 'clipboard', 'office', 'schedule',
					'contract', 'elevator', 'password', 'calendar', 'folder', 'stapler',
					'phone', 'desk', 'chair', 'final'
				],
				hp: 1600,
				playerHp: 100,
				shieldPerWord: 14,
				shieldMax: 140,
				chipPerWord: 8,
				chipFloor: 0.1,
				showNextWords: true,
				comboBreakEvery: 10,
				comboBreakPercent: 25,
				comboBreakStackPercent: 10,
				attackEverySeconds: 2.1,
				attackDamage: 23,
				wrongHealPercent: 20,
				counterDamage: 45,
				bpm: 170,
				stunSeconds: 4,
				stunPenalty: 90,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 180,
				bossHealOnStunPercent: 15,
				invulnAfterStunSeconds: 4,
				swapInvulnSeconds: 1.5,
				swapCooldownSeconds: 20,
				rankShieldPercent: [60, 80, 100],
				attacks: ['MEETING', 'DEADLINE', 'AUDIT', 'MEMO', 'REVIEW', 'TERMINATE']
			}
		]
	}
} satisfies Record<string, unknown>;

export type LiveConfig = typeof defaults;

export const env = {
	port: Number(Bun.env.PORT ?? 3000),
	mode: Bun.env.MODE ?? 'dev',
	viteOrigin: Bun.env.VITE_ORIGIN ?? 'http://localhost:5173',
	mongoUri: Bun.env.MONGO_URI?.trim() || null,
	dataDir: Bun.env.DATA_DIR ?? './data',
	adminPassword: Bun.env.ADMIN_PASSWORD ?? 'admin',
	spectatorKey: Bun.env.SPECTATOR_KEY ?? 'spectate',
	discordWebhookUrl: Bun.env.DISCORD_WEBHOOK_URL?.trim() || null
};

function merge<T>(base: T, override: unknown): T {
	if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
	const result = { ...base } as Record<string, unknown>;
	for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
		const current = result[key];
		result[key] =
			current && typeof current === 'object' && !Array.isArray(current)
				? merge(current, value)
				: value;
	}
	return result as T;
}

export function effectiveConfig(overrides: Record<string, unknown> = {}): LiveConfig {
	return merge(structuredClone(defaults), overrides);
}
