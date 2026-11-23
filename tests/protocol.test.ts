import { describe, expect, test } from 'bun:test';
import { parseClientMessage, encode } from '../src/lib/shared/protocol';
import { HOUSES, HOUSE_IDS } from '../src/lib/shared/types';

describe('shared protocol', () => {
	test('accepts a valid claim message', () => {
		expect(parseClientMessage('{"type":"claimMachine","code":"A1B2"}')).toEqual({
			type: 'claimMachine',
			code: 'A1B2'
		});
	});

	test('rejects malformed or unknown messages', () => {
		expect(parseClientMessage('not json')).toBeNull();
		expect(parseClientMessage('{"type":"nope"}')).toBeNull();
		expect(parseClientMessage('{"type":"claimMachine","code":"toolong"}')).toBeNull();
	});

	test('encodes server messages', () => {
		expect(JSON.parse(encode({ type: 'pong', sentAt: 123 }))).toEqual({
			type: 'pong',
			sentAt: 123
		});
	});
});

describe('house definitions', () => {
	test('all three houses are defined', () => {
		expect(HOUSE_IDS).toEqual(['h1', 'h2', 'h3']);
		for (const id of HOUSE_IDS) expect(HOUSES[id].id).toBe(id);
	});
});
