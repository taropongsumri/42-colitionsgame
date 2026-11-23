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
		theme: 'Generic Backrooms Boss',
		wordPool: [
			'apple', 'bread', 'chair', 'door', 'engine', 'flower', 'garden', 'hammer',
			'island', 'jacket', 'kite', 'ladder', 'mirror', 'notebook', 'orange', 'pencil',
			'quilt', 'river', 'spoon', 'table', 'umbrella', 'violin', 'water', 'yellow',
			'zebra', 'bottle', 'candle', 'dragon', 'empty', 'forest'
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
