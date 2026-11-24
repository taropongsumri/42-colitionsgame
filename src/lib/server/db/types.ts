import type { HouseId, Question, RoomStatus } from '../../shared/types';

export interface Machine {
	code: string;
	houseId: HouseId | null;
	accepted: boolean;
	sessionToken: string;
	createdAt: number;
	connected: boolean;
	lastSeen: number | null;
}

export interface Session {
	token: string;
	machineCode: string;
	houseId: HouseId | null;
	createdAt: number;
	revoked: boolean;
}

export interface BossAudition {
	/** Character classes only — the accepted answer is never stored or sent. */
	classes: number[];
	index: number;
	length: number;
	nextAt: number;
	beatMs: number;
	perHit: number;
	combo: number;
	move: string | null;
}

export interface BossState {
	active: boolean;
	bossId: string | null;
	hp: number;
	maxHp: number;
	playerHp: number;
	shield: number;
	mode: 'idle' | 'typing' | 'attack' | 'audition' | 'stunned';
	attackAt: number;
	stunUntil: number | null;
	lockUntil: number | null;
	invulnUntil: number;
	swapReadyAt: number;
	stunCount: number;
	penalty: number;
	wordsDone: number;
	/** Consecutive correct typing words; drives damage bonus and visual combos. */
	wordCombo: number;
	attackReadyAt: number;
	wordQueue: string[];
	wordIndex: number;
	audition: BossAudition | null;
	startedAt: number;
}

/** Safe defaults for old saved houses that predate the boss fight. */
export function emptyBoss(overrides: Partial<BossState> = {}): BossState {
	return {
		active: false,
		bossId: null,
		hp: 1000,
		maxHp: 1000,
		playerHp: 100,
		shield: 0,
		mode: 'idle',
		attackAt: 0,
		stunUntil: null,
		lockUntil: null,
		invulnUntil: 0,
		swapReadyAt: 0,
		stunCount: 0,
		penalty: 0,
		wordsDone: 0,
		wordCombo: 0,
		attackReadyAt: 0,
		wordQueue: [],
		wordIndex: 0,
		audition: null,
		startedAt: 0,
		...overrides
	};
}

export interface HouseState {
	id: HouseId;
	room: number;
	status: RoomStatus;
	hp: number;
	score: number;
	boss: BossState;
	answerLockUntil: number | null;
	adjustmentCount: number;
	connected: boolean;
	solvedRooms: number[];
	lastClearAt: number | null;
}

export interface GameMeta {
	startedAt: number | null;
	endsAt: number | null;
	paused: boolean;
	remainingMs: number;
	announcement: string | null;
	finished: boolean;
	orbsHidden: boolean;
}

export interface ConfigRevision {
	at: number;
	by: string;
	value: Record<string, unknown>;
}

export interface LogEntry {
	at: number;
	type: string;
	house?: HouseId;
	message: string;
	data?: Record<string, unknown>;
}

export interface Store {
	listMachines(): Promise<Machine[]>;
	getMachine(code: string): Promise<Machine | null>;
	saveMachine(machine: Machine): Promise<void>;
	deleteMachine(code: string): Promise<void>;

	getSession(token: string): Promise<Session | null>;
	saveSession(session: Session): Promise<void>;
	deleteSession(token: string): Promise<void>;

	getHouse(id: HouseId): Promise<HouseState | null>;
	listHouses(): Promise<HouseState[]>;
	saveHouse(state: HouseState): Promise<void>;

	getMeta(): Promise<GameMeta>;
	saveMeta(meta: GameMeta): Promise<void>;

	getConfig(): Promise<Record<string, unknown>>;
	setConfig(value: Record<string, unknown>, by: string): Promise<void>;
	getConfigHistory(): Promise<ConfigRevision[]>;

	listQuestions(): Promise<Question[]>;
	replaceQuestions(questions: Question[]): Promise<void>;

	appendLog(entry: LogEntry): Promise<void>;
	listLogs(limit: number): Promise<LogEntry[]>;

	close(): Promise<void>;
}
