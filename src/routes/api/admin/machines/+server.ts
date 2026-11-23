import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { getStore } from '$lib/server/db';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const store = await getStore();
	return json({ machines: await store.listMachines(), houses: await store.listHouses() });
};
