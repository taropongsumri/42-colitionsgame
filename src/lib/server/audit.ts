import { getStore } from './db';
import type { LogEntry } from './db/types';
import { notifyDiscord, type DiscordDetail, type DiscordEvent } from './discord';

/**
 * One place for the audit trail. Every entry is persisted; only entries that
 * opt into `discordEvent` also produce a Discord notification.
 */
export async function audit(
	entry: Omit<LogEntry, 'at'>,
	discordEvent?: DiscordEvent,
	detail?: DiscordDetail
): Promise<void> {
	const store = await getStore();
	await store.appendLog({ at: Date.now(), ...entry });
	if (discordEvent) {
		notifyDiscord(discordEvent, {
			house: entry.house,
			text: detail?.text ?? entry.message
		});
	}
}
