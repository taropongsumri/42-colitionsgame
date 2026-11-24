/**
 * Server-only config. Never import this file from client code.
 * Secrets come from environment variables; defaults live here.
 */

export const defaults = {
	game: {
		durationMinutes: 90,
		roomCount: 10,
		wrongAnswerLockSeconds: 10,
		stunSeconds: 30,
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
		/** Add as many entries as you want in /admin. Answers stay server-side. */
		bosses: [
			{
				id: 'staff',
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
				attackEverySeconds: 3,
				attackDamage: 15,
				wrongHealPercent: 30,
				counterDamage: 30,
				bpm: 140,
				stunSeconds: 30,
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
				name: 'Janitor',
				title: 'JANITOR // LOST FLOOR',
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
				attackEverySeconds: 2.6,
				attackDamage: 18,
				wrongHealPercent: 25,
				counterDamage: 35,
				bpm: 150,
				stunSeconds: 30,
				stunPenalty: 75,
				answerLockSeconds: [30, 60, 90, 120, 150],
				answerLockCapSeconds: 180,
				bossHealOnStunPercent: 20,
				invulnAfterStunSeconds: 4,
				swapInvulnSeconds: 2,
				swapCooldownSeconds: 25,
				rankShieldPercent: [60, 80, 100],
				attacks: ['MOP SWEEP', 'BUCKET', 'SLIP', 'DRAIN', 'WAX', 'VACUUM']
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
