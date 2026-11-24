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

/** Sends an admin announcement to every connected player. */
export async function broadcastNotice(text: string): Promise<void> {
	try {
		await fetch(
			`http://localhost:${env.port}/internal/notice?text=${encodeURIComponent(text)}`,
			{ method: 'POST' }
		);
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}

/** Pushes fresh scoreboard/shadow/ghost state after an admin mutation. */
export async function broadcastRefresh(): Promise<void> {
	try {
		await fetch(`http://localhost:${env.port}/internal/refresh`, { method: 'POST' });
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}

/** Tells every client whether spectator orbs are globally hidden. */
export async function broadcastOrbsHidden(hidden: boolean): Promise<void> {
	try {
		await fetch(
			`http://localhost:${env.port}/internal/orbs-hidden?hidden=${hidden}`,
			{ method: 'POST' }
		);
	} catch (error) {
		console.warn('[ws-control] could not reach socket server', error);
	}
}
