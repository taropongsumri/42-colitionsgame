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

export interface HouseState {
	id: HouseId;
	room: number;
	status: RoomStatus;
	hp: number;
	score: number;
	boss: { active: boolean; hp: number; maxHp: number };
	answerLockUntil: number | null;
	adjustmentCount: number;
	connected: boolean;
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

	getConfig(): Promise<Record<string, unknown>>;
	setConfig(value: Record<string, unknown>, by: string): Promise<void>;
	getConfigHistory(): Promise<ConfigRevision[]>;

	listQuestions(): Promise<Question[]>;
	replaceQuestions(questions: Question[]): Promise<void>;

	appendLog(entry: LogEntry): Promise<void>;
	listLogs(limit: number): Promise<LogEntry[]>;

	close(): Promise<void>;
}
