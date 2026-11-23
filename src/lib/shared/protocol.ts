import { z } from 'zod';

/** Message schemas shared by client and server. The server validates every inbound message. */

export const houseIdSchema = z.enum(['h1', 'h2', 'h3']);

export const clientMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ping'), sentAt: z.number() }),
	z.object({ type: z.literal('claimMachine'), code: z.string().length(4) }),
	z.object({ type: z.literal('interact'), tableId: z.string().max(64) }),
	z.object({ type: z.literal('answer'), roomId: z.string().max(64), answer: z.string().max(500) }),
	z.object({ type: z.literal('enterBoss'), bossId: z.string().max(64) }),
	z.object({ type: z.literal('typing'), word: z.string().max(64) }),
	z.object({ type: z.literal('auditionSubmit'), answer: z.string().max(500) })
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('pong'), sentAt: z.number() }),
	z.object({
		type: z.literal('welcome'),
		sessionId: z.string(),
		house: houseIdSchema.nullable()
	}),
	z.object({ type: z.literal('state'), state: z.unknown() }),
	z.object({
		type: z.literal('answerResult'),
		correct: z.boolean(),
		lockUntil: z.number().nullable()
	}),
	z.object({ type: z.literal('scoreboard'), rows: z.array(z.unknown()) }),
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
