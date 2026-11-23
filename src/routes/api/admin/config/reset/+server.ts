import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { defaults } from '../../../../../../config';
import { isAdmin } from '$lib/server/admin';
import { getStore } from '$lib/server/db';

export const POST: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const store = await getStore();
	await store.setConfig({}, 'admin:reset');
	return json({ ok: true, config: defaults });
};
