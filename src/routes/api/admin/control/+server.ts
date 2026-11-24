import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '$lib/server/admin';
import { control, type ControlInput } from '$lib/server/game/control';
import { broadcastNotice, broadcastOrbsHidden, broadcastRefresh } from '$lib/server/ws-control';
import { HOUSE_IDS, type HouseId } from '$lib/shared/types';

const actions: ControlInput['action'][] = [
	'start',
	'pause',
	'resume',
	'addTime',
	'adjustScore',
	'forceUnlock',
	'forceBoss',
	'announce',
	'hideOrbs',
	'end'
];

export const POST: RequestHandler = async ({ request }) => {
	if (!isAdmin(request)) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as ControlInput;
	if (!actions.includes(body.action)) return json({ error: 'Unknown action' }, { status: 400 });
	if (body.house && !HOUSE_IDS.includes(body.house as HouseId)) {
		return json({ error: 'Invalid house' }, { status: 400 });
	}

	const result = await control(body);
	if (result.notice !== undefined) await broadcastNotice(result.notice);
	if (body.action === 'hideOrbs') await broadcastOrbsHidden(body.hidden === true);
	else await broadcastRefresh();
	return json({ ok: true, ...result });
};
