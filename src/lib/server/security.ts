// Shared hardening helpers for the socket server. Kept pure so they can be tested
// without starting Bun.serve or opening real connections.

/** Reject oversized JSON before it reaches zod, so a bad frame cannot burn CPU. */
export const MAX_WS_MESSAGE_BYTES = 4096;

/** Cosmetic position updates are chatty; cap them per socket. */
export function createRateLimiter(
	max: number,
	windowMs: number,
	now: () => number = Date.now
): (key: string) => boolean {
	const hits = new Map<string, number[]>();
	return (key: string) => {
		const timestamp = now();
		const recent = (hits.get(key) ?? []).filter((at) => timestamp - at < windowMs);
		if (recent.length >= max) {
			hits.set(key, recent);
			return false;
		}
		recent.push(timestamp);
		hits.set(key, recent);
		// Bound memory if a client rotates identities.
		if (hits.size > 1000) {
			for (const [other, times] of hits) {
				if (!times.some((at) => timestamp - at < windowMs)) hits.delete(other);
			}
		}
		return true;
	};
}

/** Internal control calls must carry the shared secret, and it must be configured. */
export function isInternalAuthorized(request: Request, secret: string): boolean {
	return Boolean(secret) && request.headers.get('x-internal-secret') === secret;
}

/**
 * Browser WebSocket upgrades are checked against an explicit allow-list.
 * A missing Origin means a non-browser client (tests, CLIs) and is allowed.
 */
export function isAllowedOrigin(origin: string | null, allowed: ReadonlySet<string>): boolean {
	if (origin === null) return true;
	try {
		return allowed.has(new URL(origin).origin);
	} catch {
		return false;
	}
}

/**
 * Same-origin upgrades are always allowed, including when Vite prints a LAN URL
 * such as http://192.168.1.155:5173 and the socket lives on :3000. `vitePort`
 * lets that dev page open a socket on the same hostname but the socket port.
 */
export function allowedOriginsForRequest(
	request: Request,
	configured: ReadonlySet<string>,
	vitePort?: string
): Set<string> {
	const allowed = new Set(configured);
	const host = request.headers.get('host');
	if (!host) return allowed;
	const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
	const protocol =
		forwarded === 'https' ? 'https:' : new URL(request.url).protocol === 'wss:' ? 'https:' : 'http:';
	try {
		const sameOrigin = new URL(`${protocol}//${host}`);
		allowed.add(sameOrigin.origin);
		if (vitePort) allowed.add(`${sameOrigin.protocol}//${sameOrigin.hostname}:${vitePort}`);
	} catch {
		// A malformed Host header simply gets no extra allowance.
	}
	return allowed;
}

/** Vite may auto-pick 5174/5175 when an old dev page is still open. */
export function isLocalDevOrigin(origin: string | null): boolean {
	if (!origin) return false;
	try {
		const url = new URL(origin);
		return (
			url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
		);
	} catch {
		return false;
	}
}

/** Cosmetic coordinates are clamped to the current floor before being broadcast. */
export function clampCosmetic(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(max, Math.round(value)));
}
