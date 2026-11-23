import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { moveMachine } from '$lib/server/lobby';
import { kickSockets } from '$lib/server/ws-control';

export const POST: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json()) as { from?: string; to?: string };
	if (!body.from || !body.to) return json({ error: 'from and to are required' }, { status: 400 });
	try {
		const token = await moveMachine(body.from, body.to);
		await kickSockets(token);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
