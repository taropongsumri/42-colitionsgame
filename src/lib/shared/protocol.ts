import { z } from 'zod';

/** Message schemas shared by client and server. The server validates every inbound message. */

export const houseIdSchema = z.enum(['h1', 'h2', 'h3']);

export const clientMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ping'), sentAt: z.number() }),
	z.object({ type: z.literal('claimMachine'), code: z.string().length(4) }),
	z.object({ type: z.literal('interact'), tableId: z.string().max(64) }),
	z.object({
		type: z.literal('move'),
		floor: z.number().int().min(0).max(5),
		x: z.number().finite(),
		y: z.number().finite()
	}),
	z.object({ type: z.literal('answer'), roomId: z.string().max(64), answer: z.string().max(500) }),
	z.object({ type: z.literal('enterBoss'), bossId: z.string().max(64) }),
	z.object({ type: z.literal('leaveBoss') }),
	/** A completed monkey-typing word, validated against the server's queue. */
	z.object({ type: z.literal('typing'), word: z.string().max(64) }),
	z.object({ type: z.literal('auditionSubmit'), answer: z.string().max(500) }),
	z.object({ type: z.literal('bossMode'), mode: z.enum(['typing', 'attack']) }),
	z.object({ type: z.literal('bossSwap') })
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('pong'), sentAt: z.number() }),
	z.object({
		type: z.literal('welcome'),
		sessionId: z.string(),
		code: z.string(),
		house: houseIdSchema.nullable(),
		accepted: z.boolean()
	}),
	z.object({ type: z.literal('state'), state: z.unknown() }),
	z.object({
		type: z.literal('question'),
		room: z.number(),
		prompt: z.string(),
		hint: z.string().nullable()
	}),
	z.object({
		type: z.literal('dungeon'),
		current: z.number(),
		rooms: z.array(z.object({ number: z.number(), status: z.string() }))
	}),
	z.object({
		type: z.literal('shadows'),
		houses: z.array(
			z.object({ house: houseIdSchema, room: z.number(), connected: z.boolean() })
		)
	}),
	z.object({
		type: z.literal('ghosts'),
		houses: z.array(
			z.object({
				house: houseIdSchema,
				floor: z.number(),
				x: z.number(),
				y: z.number()
			})
		)
	}),
	z.object({
		type: z.literal('answerResult'),
		correct: z.boolean(),
		lockUntil: z.number().nullable()
	}),
	// Boss messages never carry accepted answers — those stay on the server.
	z.object({
		type: z.literal('boss.list'),
		bosses: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				title: z.string(),
				question: z.string(),
				hp: z.number()
			})
		)
	}),
	z.object({
		type: z.literal('boss.start'),
		boss: z.object({
			id: z.string(),
			name: z.string(),
			title: z.string(),
			question: z.string(),
			hp: z.number()
		}),
		words: z.array(z.string()),
		wordIndex: z.number(),
		hp: z.number(),
		maxHp: z.number(),
		playerHp: z.number(),
		shield: z.number(),
		mode: z.enum(['idle', 'typing', 'attack', 'audition', 'stunned']),
		attackAt: z.number(),
		stunUntil: z.number().nullable(),
		lockUntil: z.number().nullable(),
		swapReadyAt: z.number(),
		invulnUntil: z.number()
	}),
	z.object({
		type: z.literal('boss.word'),
		correct: z.boolean(),
		word: z.string(),
		nextWord: z.string(),
		shield: z.number(),
		bossHp: z.number(),
		maxHp: z.number(),
		wordsDone: z.number()
	}),
	z.object({
		type: z.literal('boss.attack'),
		move: z.string(),
		damage: z.number(),
		absorbed: z.number(),
		hp: z.number(),
		shield: z.number(),
		immune: z.boolean()
	}),
	z.object({
		type: z.literal('boss.audition'),
		length: z.number(),
		beatSeconds: z.number(),
		bossHp: z.number(),
		maxHp: z.number()
	}),
	z.object({
		type: z.literal('boss.answerResult'),
		correct: z.boolean(),
		lockUntil: z.number().nullable(),
		message: z.string()
	}),
	z.object({
		type: z.literal('boss.hit'),
		move: z.string(),
		damage: z.number(),
		bossHp: z.number(),
		maxHp: z.number(),
		combo: z.number(),
		finisher: z.boolean().optional()
	}),
	z.object({
		type: z.literal('boss.stun'),
		until: z.number(),
		seconds: z.number(),
		penalty: z.number(),
		bossHp: z.number()
	}),
	z.object({ type: z.literal('boss.ready'), playerHp: z.number(), shield: z.number() }),
	z.object({ type: z.literal('boss.swap'), readyAt: z.number(), invulnUntil: z.number() }),
	z.object({
		type: z.literal('boss.end'),
		won: z.boolean(),
		score: z.number(),
		bossHp: z.number()
	}),
	z.object({
		type: z.literal('boss.reset'),
		bossId: z.string().nullable(),
		hp: z.number(),
		maxHp: z.number(),
		reason: z.string()
	}),
	z.object({
		type: z.literal('scoreboard'),
		rows: z.array(z.unknown()),
		timeLeftMs: z.number(),
		paused: z.boolean(),
		announcement: z.string().nullable()
	}),
	z.object({ type: z.literal('notice'), text: z.string() }),
	z.object({ type: z.literal('error'), code: z.string(), message: z.string() })
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
	try {
		return clientMessageSchema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function encode(message: ServerMessage): string {
	return JSON.stringify(message);
}
