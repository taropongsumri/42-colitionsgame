import { env } from '../../../config';
import type { HouseId } from '../shared/types';

/**
 * Discord is notification-only: important events, never movement or answers.
 * Secret answers stay on the server and are never included in a payload.
 */
export type DiscordEvent =
	| 'game.start'
	| 'game.end'
	| 'room.cleared'
	| 'boss.enter'
	| 'boss.stun'
	| 'boss.defeated'
	| 'admin.action';

export type DiscordDetail = { house?: HouseId; text?: string };

export type DiscordResult = {
	ok: boolean;
	status?: number;
	reason?: 'disabled' | 'rate-limited' | 'failed';
};

const MAX_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
let sentAt: number[] = [];

/** Tests can clear the limiter between cases. */
export function clearDiscordRateLimit(): void {
	sentAt = [];
}

export function discordConfigured(): boolean {
	return Boolean(env.discordWebhookUrl);
}

export function formatDiscordMessage(event: DiscordEvent, detail: DiscordDetail = {}): string {
	const parts = ['**[Coalition Backrooms]**', event];
	if (detail.house) parts.push(`· ${detail.house}`);
	if (detail.text) parts.push(`· ${detail.text.slice(0, 160)}`);
	return parts.join(' ');
}

export interface DiscordOptions {
	url?: string;
	fetch?: typeof fetch;
	now?: () => number;
}

/** Sends one notification, enforcing the shared ~30/minute rate limit. */
export async function sendDiscordEvent(
	event: DiscordEvent,
	detail: DiscordDetail = {},
	options: DiscordOptions = {}
): Promise<DiscordResult> {
	const url = options.url ?? env.discordWebhookUrl;
	if (!url) return { ok: false, reason: 'disabled' };

	const now = options.now?.() ?? Date.now();
	sentAt = sentAt.filter((at) => now - at < WINDOW_MS);
	if (sentAt.length >= MAX_PER_MINUTE) return { ok: false, reason: 'rate-limited' };
	sentAt.push(now);

	try {
		const send = options.fetch ?? fetch;
		const response = await send(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: formatDiscordMessage(event, detail) }),
			signal: AbortSignal.timeout(5000)
		});
		return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, reason: 'failed' };
	} catch (error) {
		console.warn('[discord] send failed', error);
		return { ok: false, reason: 'failed' };
	}
}

/** Fire-and-forget for gameplay events; never blocks the game loop. */
export function notifyDiscord(event: DiscordEvent, detail: DiscordDetail = {}): void {
	void sendDiscordEvent(event, detail);
}
