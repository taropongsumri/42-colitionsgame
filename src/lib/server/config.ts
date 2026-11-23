import { effectiveConfig, type LiveConfig } from '../../../config';
import { getStore } from './db';

/** Defaults merged with the live overrides stored in MongoDB / local JSON. */
export async function liveConfig(): Promise<LiveConfig> {
	const store = await getStore();
	return effectiveConfig(await store.getConfig());
}
