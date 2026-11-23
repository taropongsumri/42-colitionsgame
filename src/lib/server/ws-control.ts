import { env } from '../../../config';

/** Closes any live socket for a revoked session. Works from either process in dev. */
export async function kickSockets(token: string): Promise<void> {
	try {
		await fetch(
			`http://localhost:${env.port}/internal/kick?token=${encodeURIComponent(token)}`,
			{ method: 'POST' }
		);
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}
