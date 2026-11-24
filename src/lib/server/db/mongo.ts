import { MongoClient, type Collection, type Document } from 'mongodb';
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

type KeyedDoc = { _id: string; [key: string]: unknown };

/** Production store. Four databases mirror the design document. */
export class MongoStore implements Store {
	private client: MongoClient;
	private content: Collection<KeyedDoc>;
	private configCollection: Collection<KeyedDoc>;
	private configHistory: Collection<Document>;
	private game: Collection<KeyedDoc>;
	private houses: Collection<KeyedDoc>;
	private sessions: Collection<KeyedDoc>;
	private meta: Collection<KeyedDoc>;
	private logs: Collection<Document>;

	private constructor(client: MongoClient) {
		this.client = client;
		this.content = client.db('coalition_content').collection('questions');
		this.configCollection = client.db('coalition_config').collection('config');
		this.configHistory = client.db('coalition_config').collection('configHistory');
		this.game = client.db('coalition_game').collection('machines');
		this.houses = client.db('coalition_game').collection('houses');
		this.sessions = client.db('coalition_game').collection('sessions');
		this.meta = client.db('coalition_game').collection('meta');
		this.logs = client.db('coalition_logs').collection('logs');
	}

	static async create(uri: string): Promise<MongoStore> {
		const client = new MongoClient(uri);
		await client.connect();
		return new MongoStore(client);
	}

	async listMachines(): Promise<Machine[]> {
		return (await this.game.find({}).toArray()).map((doc) => this.strip(doc));
	}

	async getMachine(code: string): Promise<Machine | null> {
		const doc = await this.game.findOne({ _id: code });
		return doc ? this.strip(doc) : null;
	}

	async saveMachine(machine: Machine): Promise<void> {
		await this.game.replaceOne({ _id: machine.code }, { ...machine, _id: machine.code }, { upsert: true });
	}

	async deleteMachine(code: string): Promise<void> {
		await this.game.deleteOne({ _id: code });
	}

	async getSession(token: string): Promise<Session | null> {
		const doc = await this.sessions.findOne({ _id: token });
		return doc ? this.strip(doc) : null;
	}

	async saveSession(session: Session): Promise<void> {
		await this.sessions.replaceOne({ _id: session.token }, { ...session, _id: session.token }, { upsert: true });
	}

	async deleteSession(token: string): Promise<void> {
		await this.sessions.deleteOne({ _id: token });
	}

	async getHouse(id: HouseId): Promise<HouseState | null> {
		const doc = await this.houses.findOne({ _id: id });
		return doc ? this.normalizeHouse(doc) : null;
	}

	async listHouses(): Promise<HouseState[]> {
		return (await this.houses.find({}).toArray()).map((doc) => this.normalizeHouse(doc));
	}

	private normalizeHouse(doc: Record<string, unknown>): HouseState {
		const house = this.strip<HouseState>(doc);
		house.solvedRooms ??= [];
		house.lastClearAt ??= null;
		house.boss = emptyBoss(house.boss ?? {});
		return house;
	}

	async saveHouse(state: HouseState): Promise<void> {
		await this.houses.replaceOne({ _id: state.id }, { ...state, _id: state.id }, { upsert: true });
	}

	async getMeta(): Promise<GameMeta> {
		const doc = await this.meta.findOne({ _id: 'game' });
		return {
			startedAt: null,
			endsAt: null,
			paused: false,
			remainingMs: 0,
			announcement: null,
			finished: false,
			orbsHidden: false,
			...(doc ? this.strip<Partial<GameMeta>>(doc) : {})
		};
	}

	async saveMeta(meta: GameMeta): Promise<void> {
		await this.meta.replaceOne({ _id: 'game' }, { ...meta, _id: 'game' }, { upsert: true });
	}

	async getConfig(): Promise<Record<string, unknown>> {
		const doc = await this.configCollection.findOne({ _id: 'live' });
		return (doc?.value as Record<string, unknown>) ?? {};
	}

	async setConfig(value: Record<string, unknown>, by: string): Promise<void> {
		await this.configCollection.replaceOne({ _id: 'live' }, { _id: 'live', value }, { upsert: true });
		const revision: ConfigRevision = { at: Date.now(), by, value };
		await this.configHistory.insertOne({ ...revision });
	}

	async getConfigHistory(): Promise<ConfigRevision[]> {
		return (await this.configHistory.find({}).sort({ at: -1 }).limit(100).toArray()).map((doc) =>
			this.strip(doc)
		);
	}

	async listQuestions(): Promise<Question[]> {
		return (await this.content.find({}).sort({ _id: 1 }).toArray()).map((doc) => this.strip(doc));
	}

	async replaceQuestions(questions: Question[]): Promise<void> {
		await this.content.deleteMany({});
		if (questions.length) {
			await this.content.insertMany(questions.map((q) => ({ ...q, _id: q.id })));
		}
	}

	async appendLog(entry: LogEntry): Promise<void> {
		await this.logs.insertOne({ ...entry });
	}

	async listLogs(limit: number): Promise<LogEntry[]> {
		return (await this.logs.find({}).sort({ at: -1 }).limit(limit).toArray()).map((doc) =>
			this.strip(doc)
		);
	}

	async close(): Promise<void> {
		await this.client.close();
	}

	private strip<T>(doc: Record<string, unknown>): T {
		const { _id: _ignored, ...rest } = doc;
		return rest as T;
	}
}
