import { describe, expect, test } from 'bun:test';
import {
	allowedOriginsForRequest,
	clampCosmetic,
	createRateLimiter,
	isAllowedOrigin,
	isInternalAuthorized,
	MAX_WS_MESSAGE_BYTES
} from '../src/lib/server/security';

describe('internal control auth', () => {
	const request = (headers: Record<string, string> = {}) =>
		new Request('http://localhost:3000/internal/refresh', { method: 'POST', headers });

	test('requires a configured secret and a matching header', () => {
		expect(isInternalAuthorized(request(), 'dev-internal')).toBe(false);
		expect(isInternalAuthorized(request({ 'x-internal-secret': 'wrong' }), 'dev-internal')).toBe(false);
		expect(isInternalAuthorized(request({ 'x-internal-secret': 'dev-internal' }), '')).toBe(false);
		expect(isInternalAuthorized(request({ 'x-internal-secret': 'dev-internal' }), 'dev-internal')).toBe(true);
	});
});

describe('WebSocket origin allow-list', () => {
	const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:5173', 'https://play.example.com']);

	test('accepts non-browser clients, allowed origins, and rejects everything else', () => {
		expect(isAllowedOrigin(null, allowed)).toBe(true);
		expect(isAllowedOrigin('http://localhost:3000', allowed)).toBe(true);
		expect(isAllowedOrigin('http://127.0.0.1:5173', allowed)).toBe(true);
		expect(isAllowedOrigin('https://play.example.com', allowed)).toBe(true);
		expect(isAllowedOrigin('https://evil.example.com', allowed)).toBe(false);
		expect(isAllowedOrigin('http://localhost:3000.evil.com', allowed)).toBe(false);
		expect(isAllowedOrigin('not a url', allowed)).toBe(false);
	});

	test('allows a LAN Vite page to reach the socket on the same hostname', () => {
		const request = new Request('http://192.168.1.155:3000/ws/play', {
			headers: { host: '192.168.1.155:3000' }
		});
		const requestOrigins = allowedOriginsForRequest(request, allowed, '5173');
		expect(isAllowedOrigin('http://192.168.1.155:5173', requestOrigins)).toBe(true);
		expect(isAllowedOrigin('http://192.168.1.155:3000', requestOrigins)).toBe(true);
		expect(isAllowedOrigin('https://evil.example.com', requestOrigins)).toBe(false);
	});
});

describe('cosmetic input bounds', () => {
	test('clamps positions to the floor and rejects NaN', () => {
		expect(clampCosmetic(-50, 608)).toBe(0);
		expect(clampCosmetic(1e9, 608)).toBe(608);
		expect(clampCosmetic(Number.NaN, 608)).toBe(0);
		expect(clampCosmetic(12.7, 608)).toBe(13);
		expect(MAX_WS_MESSAGE_BYTES).toBeGreaterThan(0);
	});
});

describe('cosmetic rate limit', () => {
	test('allows a burst then throttles, and recovers with time', () => {
		let now = 1000;
		const allow = createRateLimiter(3, 1000, () => now);
		expect([allow('h1'), allow('h1'), allow('h1')]).toEqual([true, true, true]);
		expect(allow('h1')).toBe(false);
		now += 1001;
		expect(allow('h1')).toBe(true);
		expect(allow('h2')).toBe(true);
	});
});
