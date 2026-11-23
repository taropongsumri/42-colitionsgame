import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { acceptMachine, assignHouse, kickMachine } from '$lib/server/lobby';
import { kickSockets } from '$lib/server/ws-control';
import { HOUSE_IDS, type HouseId } from '$lib/shared/types';

const guard = (request: Request) => isAdmin(request);

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!guard(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json()) as { house?: string };
	if (!body.house || !HOUSE_IDS.includes(body.house as HouseId)) {
		return json({ error: 'Invalid house' }, { status: 400 });
	}
	try {
		await assignHouse(params.code, body.house as HouseId);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!guard(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		await acceptMachine(params.code);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	if (!guard(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const token = await kickMachine(params.code);
	if (token) await kickSockets(token);
	return json({ ok: true });
};
