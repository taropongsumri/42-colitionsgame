import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { effectiveConfig } from '../../../../../config';
import { isAdmin } from '$lib/server/admin';
import { getStore } from '$lib/server/db';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const store = await getStore();
	const overrides = await store.getConfig();
	return json({
		config: effectiveConfig(overrides),
		history: await store.getConfigHistory()
	});
};

export const PUT: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json()) as { config?: Record<string, unknown> };
	if (!body.config || typeof body.config !== 'object') {
		return json({ error: 'config object is required' }, { status: 400 });
	}
	const store = await getStore();
	await store.setConfig(body.config, 'admin');
	return json({ ok: true, config: effectiveConfig(body.config) });
};
