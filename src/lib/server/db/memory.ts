import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../config';
import type { HouseId, Question } from '../../shared/types';
import type {
	ConfigRevision,
	GameMeta,
	HouseState,
	LogEntry,
	Machine,
	Session,
	Store
} from './types';
import { emptyBoss } from './types';

interface Persisted {
	machines: Record<string, Machine>;
	sessions: Record<string, Session>;
	houses: Record<string, HouseState>;
	config: { value: Record<string, unknown>; history: ConfigRevision[] };
	questions: Question[];
	logs: LogEntry[];
	meta: GameMeta;
}

const defaultMeta = (): GameMeta => ({
	open: false,
	startedAt: null,
	endsAt: null,
	paused: false,
	remainingMs: 0,
	announcement: null,
	finished: false,
	orbsHidden: false
});

const empty = (): Persisted => ({
	machines: {},
	sessions: {},
	houses: {},
	config: { value: {}, history: [] },
	questions: [],
	logs: [],
	meta: defaultMeta()
});

/**
 * Zero-dependency store for local development. State is mirrored to a JSON
 * file and reloaded on every operation, so the Vite process (HTTP) and the
 * Bun process (WebSocket) can share it without a database server.
 */
export class MemoryStore implements Store {
	private state: Persisted = empty();
	private readonly file: string;

	private constructor(file: string) {
		this.file = file;
	}

	static async create(): Promise<MemoryStore> {
		const dir = env.dataDir;
		await mkdir(dir, { recursive: true });
		return new MemoryStore(join(dir, 'store.json'));
	}

	private async load(): Promise<void> {
		const text = await Bun.file(this.file).text().catch(() => null);
		if (!text) {
			this.state = empty();
			return;
		}
		try {
			const parsed = JSON.parse(text) as Partial<Persisted>;
			this.state = {
				...empty(),
				...parsed,
				meta: { ...defaultMeta(), ...parsed.meta },
				config: { ...empty().config, ...parsed.config }
			};
			for (const house of Object.values(this.state.houses)) {
				house.solvedRooms ??= [];
				house.lastClearAt ??= null;
				house.questionOrder ??= [];
				house.defeatedBosses ??= [];
				house.bossRetryAt ??= null;
				house.boss = emptyBoss(house.boss ?? {});
			}
		} catch {
			this.state = empty();
		}
	}

	private async save(): Promise<void> {
		await Bun.write(this.file, JSON.stringify(this.state, null, 2));
	}

	async listMachines(): Promise<Machine[]> {
		await this.load();
		return Object.values(this.state.machines);
	}

	async getMachine(code: string): Promise<Machine | null> {
		await this.load();
		return this.state.machines[code] ?? null;
	}

	async saveMachine(machine: Machine): Promise<void> {
		await this.load();
		this.state.machines[machine.code] = machine;
		await this.save();
	}

	async deleteMachine(code: string): Promise<void> {
		await this.load();
		delete this.state.machines[code];
		await this.save();
	}

	async getSession(token: string): Promise<Session | null> {
		await this.load();
		return this.state.sessions[token] ?? null;
	}

	async saveSession(session: Session): Promise<void> {
		await this.load();
		this.state.sessions[session.token] = session;
		await this.save();
	}

	async deleteSession(token: string): Promise<void> {
		await this.load();
		delete this.state.sessions[token];
		await this.save();
	}

	async getHouse(id: HouseId): Promise<HouseState | null> {
		await this.load();
		return this.state.houses[id] ?? null;
	}

	async listHouses(): Promise<HouseState[]> {
		await this.load();
		return Object.values(this.state.houses);
	}

	async saveHouse(state: HouseState): Promise<void> {
		await this.load();
		this.state.houses[state.id] = state;
		await this.save();
	}

	async getMeta(): Promise<GameMeta> {
		await this.load();
		return structuredClone(this.state.meta);
	}

	async saveMeta(meta: GameMeta): Promise<void> {
		await this.load();
		this.state.meta = structuredClone(meta);
		await this.save();
	}

	async getConfig(): Promise<Record<string, unknown>> {
		await this.load();
		return structuredClone(this.state.config.value);
	}

	async setConfig(value: Record<string, unknown>, by: string): Promise<void> {
		await this.load();
		this.state.config.value = structuredClone(value);
		this.state.config.history.push({ at: Date.now(), by, value: structuredClone(value) });
		this.state.config.history = this.state.config.history.slice(-100);
		await this.save();
	}

	async getConfigHistory(): Promise<ConfigRevision[]> {
		await this.load();
		return structuredClone(this.state.config.history);
	}

	async listQuestions(): Promise<Question[]> {
		await this.load();
		return structuredClone(this.state.questions);
	}

	async replaceQuestions(questions: Question[]): Promise<void> {
		await this.load();
		this.state.questions = structuredClone(questions);
		await this.save();
	}

	async appendLog(entry: LogEntry): Promise<void> {
		await this.load();
		this.state.logs.push(entry);
		this.state.logs = this.state.logs.slice(-2000);
		await this.save();
	}

	async listLogs(limit: number): Promise<LogEntry[]> {
		await this.load();
		return this.state.logs.slice(-limit).reverse();
	}

	async close(): Promise<void> {
		// nothing to flush: every write is persisted immediately
	}
}
