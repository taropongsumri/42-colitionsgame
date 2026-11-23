import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMachineSession, getSessionView, SESSION_COOKIE } from '$lib/server/lobby';

export const GET: RequestHandler = async ({ cookies }) => {
	return json({ session: await getSessionView(cookies.get(SESSION_COOKIE)) });
};

export const POST: RequestHandler = async ({ cookies }) => {
	const existing = await getSessionView(cookies.get(SESSION_COOKIE));
	if (existing) return json({ session: existing });

	const { token } = await createMachineSession();
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24
	});
	return json({ session: await getSessionView(token) });
};
