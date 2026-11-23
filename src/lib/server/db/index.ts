import { env } from '../../../../config';
import { MemoryStore } from './memory';
import { MongoStore } from './mongo';
import type { Store } from './types';

let instance: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
	return (instance ??= createStore());
}

async function createStore(): Promise<Store> {
	if (env.mongoUri) {
		console.log('[store] using MongoDB');
		return MongoStore.create(env.mongoUri);
	}
	console.log('[store] using local JSON store (set MONGO_URI to use MongoDB)');
	return MemoryStore.create();
}

export type { Store } from './types';
