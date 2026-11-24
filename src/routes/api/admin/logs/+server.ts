import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { getStore } from '$lib/server/db';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
	const type = url.searchParams.get('type') ?? '';
	const store = await getStore();
	const logs = await store.listLogs(limit * (type ? 5 : 1));
	return json({
		logs: type ? logs.filter((entry) => entry.type === type).slice(0, limit) : logs,
		configHistory: (await store.getConfigHistory()).slice(-20).reverse()
	});
};
