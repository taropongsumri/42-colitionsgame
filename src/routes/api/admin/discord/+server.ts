import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { discordConfigured, sendDiscordEvent } from '$lib/server/discord';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ configured: discordConfigured(), maxPerMinute: 30 });
};

export const POST: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { test?: boolean };
	if (!body.test) return json({ error: 'test is required' }, { status: 400 });
	const result = await sendDiscordEvent('admin.action', { text: 'Admin test notification' });
	return json({ configured: discordConfigured(), ...result });
};
