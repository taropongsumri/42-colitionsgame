import { env } from '../../../config';

/** Internal control calls are authenticated with the shared secret from config. */
const headers = { 'x-internal-secret': env.internalSecret };

function internalUrl(path: string, params: Record<string, string> = {}): string {
	const url = new URL(`http://localhost:${env.port}${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url.toString();
}

/** Closes any live socket for a revoked session. Works from either process in dev. */
export async function kickSockets(token: string): Promise<void> {
	try {
		await fetch(internalUrl('/internal/kick', { token }), { method: 'POST', headers });
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}

/** Sends an admin announcement to every connected player. */
export async function broadcastNotice(text: string): Promise<void> {
	try {
		await fetch(internalUrl('/internal/notice', { text }), { method: 'POST', headers });
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}

/** Pushes fresh scoreboard/shadow/ghost state after an admin mutation. */
export async function broadcastRefresh(): Promise<void> {
	try {
		await fetch(internalUrl('/internal/refresh'), { method: 'POST', headers });
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}

/** Tells every client whether spectator orbs are globally hidden. */
export async function broadcastOrbsHidden(hidden: boolean): Promise<void> {
	try {
		await fetch(internalUrl('/internal/orbs-hidden', { hidden: String(hidden) }), {
			method: 'POST',
			headers
		});
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}
